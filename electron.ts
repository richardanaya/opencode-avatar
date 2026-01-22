import { app, BrowserWindow, screen, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';
require('dotenv').config();

function getFalKey(): string | null {
  try {
    const configPath = path.join(os.homedir(), '.config', 'opencode', 'opencode-avatar.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!config.falKey) {
      console.warn('Warning: falKey not found in config file. Avatar generation will not work. Please set falKey in ~/.config/opencode/opencode-avatar.json');
      return null;
    }
    return config.falKey;
  } catch (error) {
    console.warn(`Warning: Failed to read config file: ${error.message}. Avatar generation will not work. Please ensure ~/.config/opencode/opencode-avatar.json exists and contains falKey.`);
    return null;
  }
}

const FAL_CDN_URL = 'https://v3.fal.media';
const FAL_REST_URL = 'https://rest.alpha.fal.ai';
const FAL_NANO_BANANA_URL = 'https://fal.run/fal-ai/nano-banana-pro/edit';

// Get directory path reliably for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirnameResolved = path.dirname(__filename);
// __dirname is dist/ when compiled, so go up one level to find assets
// const AVATAR_DIR = path.join(__dirnameResolved, '..');
const AVATAR_DIR = path.join(os.homedir(), '.config', 'opencode');




const HTML_CONTENT = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Desktop Clippy</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      width: 100%;
      height: 100%;
      background: transparent;
      overflow: hidden;
      -webkit-app-region: drag;
    }

    .container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: center;
    }

    #avatar {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      -webkit-user-drag: none;
      pointer-events: auto;
      -webkit-app-region: drag;
    }

    canvas {
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <img id="avatar" alt="Clippy">
  </div>
  <canvas id="canvas"></canvas>

  <script>
    const { ipcRenderer } = require('electron');

    const img = document.getElementById('avatar');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    function loadAvatar(avatarPath) {
      const srcImg = new Image();
      srcImg.src = avatarPath;

      srcImg.onload = function() {
        canvas.width = srcImg.width;
        canvas.height = srcImg.height;

        ctx.drawImage(srcImg, 0, 0);

        const topLeftPixel = ctx.getImageData(0, 0, 1, 1).data;
        const chromaR = topLeftPixel[0];
        const chromaG = topLeftPixel[1];
        const chromaB = topLeftPixel[2];


        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const tolerance = 30;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          if (
            Math.abs(r - chromaR) <= tolerance &&
            Math.abs(g - chromaG) <= tolerance &&
            Math.abs(b - chromaB) <= tolerance
          ) {
            data[i + 3] = 0;
          }
        }

        ctx.putImageData(imageData, 0, 0);
        img.src = canvas.toDataURL('image/png');
      };

      srcImg.onerror = function(e) {
        console.error('Failed to load image:', e);
        img.src = 'avatar.svg';
      };
    }

    ipcRenderer.on('set-avatar', (event, avatarDataUrl) => {
      loadAvatar(avatarDataUrl);
    });

    // Fallback: load default avatar if no IPC message received
    setTimeout(() => {
      if (!img.src) {
        ipcRenderer.send('request-avatar');
      }
    }, 500);
  </script>
</body>
</html>`;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let httpServer: http.Server | null = null;
let ongoingGenerations = new Map<string, Promise<void>>();
let lastHeartbeat = Date.now();
const HEARTBEAT_TIMEOUT = 1000; // 1 second without heartbeat = shutdown

function promptToFilename(prompt: string): string {
  return 'avatar_' + prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50) + '.png';
}

function getAvatarPort(): number {
  const args = process.argv;
  const portIndex = args.indexOf('--avatar-port');
  if (portIndex !== -1 && args[portIndex + 1]) {
    return parseInt(args[portIndex + 1], 10);
  }
  return 47291;
}

function getAvatarPath(): string {
  const args = process.argv;
  const avatarIndex = args.indexOf('--avatar');
  if (avatarIndex !== -1 && args[avatarIndex + 1]) {
    const avatarArg = args[avatarIndex + 1];
    // If relative path, resolve from AVATAR_DIR
    if (!path.isAbsolute(avatarArg)) {
      return path.join(AVATAR_DIR, avatarArg);
    }
    return avatarArg;
  }
  return path.join(AVATAR_DIR, 'avatar.png');
}

async function uploadFile(filePath: string, falKey: string): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const tokenResponse = await fetch(`${FAL_REST_URL}/storage/auth/token?storage_type=fal-cdn-v3`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${falKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    throw new Error(`Failed to get upload token: ${tokenResponse.status} ${tokenResponse.statusText} - ${text}`);
  }

  const tokenData = await tokenResponse.json() as { base_upload_url?: string; token: string };

  const uploadUrl = `${tokenData.base_upload_url || FAL_CDN_URL}/files/upload`;
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenData.token}`,
      'Content-Type': 'image/png',
      'X-Fal-File-Name': fileName
    },
    body: fileBuffer
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to upload file: ${response.status} ${response.statusText} - ${text}`);
  }

  const result = await response.json() as { access_url?: string; url?: string };
  return result.access_url || result.url || '';
}

async function generateAvatarImage(imageUrl: string, prompt: string, falKey: string): Promise<{ images?: { url: string }[]; image?: { url: string }; url?: string }> {
  const response = await fetch(FAL_NANO_BANANA_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${falKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      prompt: prompt,
      image_urls: [imageUrl]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to generate avatar: ${response.status} ${response.statusText} - ${text}`);
  }

  return response.json() as Promise<{ images?: { url: string }[]; image?: { url: string }; url?: string }>;
}

async function downloadImage(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}

async function generateAvatarForPrompt(prompt: string): Promise<string> {
  const falKey = getFalKey();
  if (!falKey) {
    console.warn('falKey is not set. Cannot generate avatar. Using default avatar.');
    return path.join(AVATAR_DIR, 'avatar.png');
  }

  const cachedFilename = promptToFilename(prompt);
  const cachedPath = path.join(AVATAR_DIR, cachedFilename);

  // Check file cache first
  if (fs.existsSync(cachedPath)) {
    return cachedPath;
  }

  // Check if generation already in progress - if so, wait for it
  if (ongoingGenerations.has(cachedFilename)) {
    await ongoingGenerations.get(cachedFilename);
    return cachedPath;
  }

  // Create and store the promise BEFORE starting async work to prevent race conditions
  const generationPromise = (async () => {
    try {
      // Double-check file doesn't exist (might have been created while waiting)
      if (fs.existsSync(cachedPath)) {
        return;
      }


      const sourceAvatar = path.join(AVATAR_DIR, 'avatar.png');
      const uploadedUrl = await uploadFile(sourceAvatar, falKey);

      const fullPrompt = `make a character variant: ${prompt}. Keep the background as a solid green screen color. Do not let the green screen color appear in reflections or on the subject.`;
      const result = await generateAvatarImage(uploadedUrl, fullPrompt, falKey);

      const outputUrl = result.images?.[0]?.url || result.image?.url || result.url;
      if (!outputUrl) {
        throw new Error('No output image URL in response: ' + JSON.stringify(result, null, 2));
      }

      await downloadImage(outputUrl, cachedPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Error generating avatar:', message);
      throw error;
    } finally {
      ongoingGenerations.delete(cachedFilename);
    }
  })();

  // Store immediately so concurrent requests see it
  ongoingGenerations.set(cachedFilename, generationPromise);
  
  await generationPromise;
  return cachedPath;
}

function startHeartbeatChecker() {
  setInterval(() => {
    const timeSinceLastHeartbeat = Date.now() - lastHeartbeat;
    if (timeSinceLastHeartbeat > HEARTBEAT_TIMEOUT) {
      (app as typeof app & { isQuitting?: boolean }).isQuitting = true;
      app.quit();
    }
  }, 1000);
}

function startAvatarServer() {
  const port = getAvatarPort();
  httpServer = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/set-avatar') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { avatarPath } = JSON.parse(body);
          if (mainWindow && avatarPath) {
            const imageBuffer = fs.readFileSync(avatarPath);
            const base64 = imageBuffer.toString('base64');
            const dataUrl = `data:image/png;base64,${base64}`;
            mainWindow.webContents.send('set-avatar', dataUrl);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
    } else if (req.method === 'POST' && req.url === '/generate-avatar') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { prompt } = JSON.parse(body);
          if (!prompt) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing prompt' }));
            return;
          }
          const avatarPath = await generateAvatarForPrompt(prompt);
          if (mainWindow) {
            const imageBuffer = fs.readFileSync(avatarPath);
            const base64 = imageBuffer.toString('base64');
            const dataUrl = `data:image/png;base64,${base64}`;
            mainWindow.webContents.send('set-avatar', dataUrl);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, avatarPath }));
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error('Error in generate-avatar:', e);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: message }));
        }
      });
    } else if (req.method === 'GET' && req.url === '/health') {
      // Health check endpoint
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else if (req.method === 'POST' && req.url === '/heartbeat') {
      // Heartbeat endpoint - plugin calls this periodically
      lastHeartbeat = Date.now();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else if (req.method === 'POST' && req.url === '/shutdown') {
      // Shutdown endpoint
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'shutting down' }));
      // Give response time to send, then quit
      setTimeout(() => {
        (app as typeof app & { isQuitting?: boolean }).isQuitting = true;
        app.quit();
      }, 100);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  httpServer.listen(port, '127.0.0.1', () => {
  });
  httpServer.on('error', (err) => {
  });
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const windowWidth = 150;
  const windowHeight = 200;

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: width - windowWidth - 100,
    y: height - windowHeight,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    show: false, // Don't show immediately to prevent focus stealing
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML_CONTENT)}`);

  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow) {
      const avatarPath = getAvatarPath();
      try {
        // Convert to base64 data URL since we're loading HTML from a data URL
        const imageBuffer = fs.readFileSync(avatarPath);
        const base64 = imageBuffer.toString('base64');
        const dataUrl = `data:image/png;base64,${base64}`;
        mainWindow.webContents.send('set-avatar', dataUrl);

        // Show window after avatar is set, without stealing focus
        setTimeout(() => {
          if (mainWindow && !mainWindow.isVisible()) {
            mainWindow.show();
            mainWindow.setAlwaysOnTop(true, 'screen-saver'); // Keep on top but don't steal focus
          }
        }, 100);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
      }
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
  });

  mainWindow.on('close', (e) => {
    if (!(app as typeof app & { isQuitting?: boolean }).isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

}

function createTray() {
  let trayIcon;
  try {
    const pngPath = path.join(AVATAR_DIR, 'avatar.png');
    trayIcon = nativeImage.createFromPath(pngPath);
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createFromPath(path.join(AVATAR_DIR, 'avatar.svg'));
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    trayIcon = nativeImage.createFromPath(path.join(AVATAR_DIR, 'avatar.svg'));
  }
  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide',
      click: () => mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show()
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        (app as typeof app & { isQuitting?: boolean }).isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Desktop Clippy');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show());
}

app.commandLine.appendSwitch('enable-transparent-visuals');

app.whenReady().then(async () => {
  // Ensure avatar directory exists
  fs.mkdirSync(AVATAR_DIR, { recursive: true });

  // Check and download default avatar if needed
  const avatarPath = path.join(AVATAR_DIR, 'avatar.png');
  if (!fs.existsSync(avatarPath)) {
    try {
      await downloadImage('https://richardanaya.github.io/opencode-avatar/avatar.png', avatarPath);
      console.log('Downloaded default avatar to', avatarPath);
    } catch (error) {
      console.warn('Failed to download default avatar:', error);
    }
  }

  setTimeout(() => {
    createWindow();
    createTray();
    startAvatarServer();
    startHeartbeatChecker();
  }, 300);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

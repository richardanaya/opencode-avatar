import { app, BrowserWindow, screen, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as http from 'http';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
require('dotenv').config();

const FAL_CDN_URL = 'https://v3.fal.media';
const FAL_REST_URL = 'https://rest.alpha.fal.ai';
const FAL_NANO_BANANA_URL = 'https://fal.run/fal-ai/nano-banana-pro/edit';

// Get directory path reliably for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirnameResolved = path.dirname(__filename);
// __dirname is dist/ when compiled, so go up one level to find assets
const AVATAR_DIR = path.join(__dirnameResolved, '..');
const LOG_FILE = path.join(AVATAR_DIR, 'avatar.log');

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [electron] ${message}\n`;
  fs.appendFileSync(LOG_FILE, logLine);
}

log('========== Electron process starting ==========');
log(`__filename: ${__filename}`);
log(`__dirnameResolved: ${__dirnameResolved}`);
log(`AVATAR_DIR: ${AVATAR_DIR}`);
log(`process.argv: ${process.argv.join(' ')}`);

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

        console.log(\`Chroma key color: rgb(\${chromaR}, \${chromaG}, \${chromaB})\`);

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
      console.log('Received avatar data URL, length:', avatarDataUrl.length);
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

async function uploadFile(filePath: string): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const tokenResponse = await fetch(`${FAL_REST_URL}/storage/auth/token?storage_type=fal-cdn-v3`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${process.env.FAL_KEY}`,
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

async function generateAvatarImage(imageUrl: string, prompt: string): Promise<{ images?: { url: string }[]; image?: { url: string }; url?: string }> {
  const response = await fetch(FAL_NANO_BANANA_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${process.env.FAL_KEY}`,
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

      console.log(`Generating avatar for prompt: "${prompt}"`);

      const sourceAvatar = path.join(AVATAR_DIR, 'avatar.png');
      const uploadedUrl = await uploadFile(sourceAvatar);
      console.log(`Uploaded: ${uploadedUrl}`);

      const fullPrompt = `make a character variant: ${prompt}. Keep the background as a solid green screen color. Do not let the green screen color appear in reflections or on the subject.`;
      const result = await generateAvatarImage(uploadedUrl, fullPrompt);

      const outputUrl = result.images?.[0]?.url || result.image?.url || result.url;
      if (!outputUrl) {
        throw new Error('No output image URL in response: ' + JSON.stringify(result, null, 2));
      }

      await downloadImage(outputUrl, cachedPath);
      console.log(`Downloaded result to ${cachedFilename}`);
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
  log('Starting heartbeat checker');
  setInterval(() => {
    const timeSinceLastHeartbeat = Date.now() - lastHeartbeat;
    if (timeSinceLastHeartbeat > HEARTBEAT_TIMEOUT) {
      log(`No heartbeat for ${timeSinceLastHeartbeat}ms, shutting down`);
      (app as typeof app & { isQuitting?: boolean }).isQuitting = true;
      app.quit();
    }
  }, 1000);
}

function startAvatarServer() {
  const port = getAvatarPort();
  log(`Starting HTTP server on port ${port}`);
  httpServer = http.createServer(async (req, res) => {
    log(`HTTP request: ${req.method} ${req.url}`);
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
      log('Health check request received');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else if (req.method === 'POST' && req.url === '/heartbeat') {
      // Heartbeat endpoint - plugin calls this periodically
      lastHeartbeat = Date.now();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else if (req.method === 'POST' && req.url === '/shutdown') {
      // Shutdown endpoint
      log('Shutdown request received');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'shutting down' }));
      // Give response time to send, then quit
      setTimeout(() => {
        log('Executing shutdown');
        (app as typeof app & { isQuitting?: boolean }).isQuitting = true;
        app.quit();
      }, 100);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  httpServer.listen(port, '127.0.0.1', () => {
    log(`Avatar HTTP server listening on port ${port}`);
  });
  httpServer.on('error', (err) => {
    log(`HTTP server error: ${err.message}`);
  });
}

function createWindow() {
  log('createWindow called');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  log(`Primary display workAreaSize: ${width}x${height}`);

  const windowWidth = 150;
  const windowHeight = 200;

  log(`Creating BrowserWindow at position (${width - windowWidth - 100}, ${height - windowHeight})`);
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

  log('Loading HTML content into window');
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML_CONTENT)}`);

  mainWindow.webContents.on('did-finish-load', () => {
    log('Window did-finish-load event fired');
    if (mainWindow) {
      const avatarPath = getAvatarPath();
      log(`Sending initial avatar: ${avatarPath}`);
      log(`Avatar file exists: ${fs.existsSync(avatarPath)}`);
      try {
        // Convert to base64 data URL since we're loading HTML from a data URL
        const imageBuffer = fs.readFileSync(avatarPath);
        const base64 = imageBuffer.toString('base64');
        const dataUrl = `data:image/png;base64,${base64}`;
        log(`Sending avatar data URL (length: ${dataUrl.length})`);
        mainWindow.webContents.send('set-avatar', dataUrl);
        log('Avatar sent to renderer');

        // Show window after avatar is set, without stealing focus
        setTimeout(() => {
          if (mainWindow && !mainWindow.isVisible()) {
            log('Showing window after avatar load');
            mainWindow.show();
            mainWindow.setAlwaysOnTop(true, 'screen-saver'); // Keep on top but don't steal focus
          }
        }, 100);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`ERROR reading/sending avatar: ${message}`);
      }
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log(`Window did-fail-load: ${errorCode} - ${errorDescription}`);
  });

  mainWindow.on('close', (e) => {
    log('Window close event');
    if (!(app as typeof app & { isQuitting?: boolean }).isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
      log('Window hidden instead of closed');
    }
  });

  log('Window created successfully');
}

function createTray() {
  log('createTray called');
  let trayIcon;
  try {
    const pngPath = path.join(AVATAR_DIR, 'avatar.png');
    log(`Loading tray icon from: ${pngPath}`);
    trayIcon = nativeImage.createFromPath(pngPath);
    if (trayIcon.isEmpty()) {
      log('PNG tray icon is empty, trying SVG');
      trayIcon = nativeImage.createFromPath(path.join(AVATAR_DIR, 'avatar.svg'));
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(`Error loading tray icon: ${message}`);
    trayIcon = nativeImage.createFromPath(path.join(AVATAR_DIR, 'avatar.svg'));
  }
  log(`Tray icon isEmpty: ${trayIcon.isEmpty()}`);
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

app.whenReady().then(() => {
  log('App ready event fired');
  setTimeout(() => {
    log('Timeout complete, creating window and tray');
    createWindow();
    createTray();
    startAvatarServer();
    startHeartbeatChecker();
    log('All components initialized');
  }, 300);
});

app.on('window-all-closed', () => {
  log('All windows closed');
  if (process.platform !== 'darwin') app.quit();
});

import { type Plugin } from "@opencode-ai/plugin";
import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import * as http from "http";
import * as fs from "fs";

const AVATAR_DIR = __dirname;
const DEFAULT_AVATAR = "avatar.png";
const THINKING_PROMPT = "thinking hard";
const AVATAR_PORT = 47291;
const LOG_FILE = path.join(AVATAR_DIR, "avatar.log");
const LOCK_FILE = path.join(AVATAR_DIR, ".avatar.lock");

// Function to create descriptive prompt from tool info
function getToolPrompt(toolName: string, toolDescription?: string): string {
  if (toolDescription) {
    // Use tool name + first part of description for better prompt
    const shortDesc = toolDescription.split('.')[0].substring(0, 50);
    return `${toolName} - ${shortDesc}`;
  }
  // Fallback to just tool name
  return toolName;
}

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [plugin] ${message}\n`;
  fs.appendFileSync(LOG_FILE, logLine);
}

let electronProcess: ChildProcess | null = null;
let currentAvatar: string = DEFAULT_AVATAR;
let isThinking = false;
let isToolActive = false;
let isShuttingDown = false;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

// Send heartbeat to keep Electron alive
function sendHeartbeat(): void {
  const req = http.request({
    hostname: 'localhost',
    port: AVATAR_PORT,
    path: '/heartbeat',
    method: 'POST',
    timeout: 1000
  }, () => {});
  req.on('error', () => {}); // Ignore errors
  req.on('timeout', () => req.destroy());
  req.end();
}

function startHeartbeat(): void {
  if (heartbeatInterval) return;
  log('Starting heartbeat');
  sendHeartbeat(); // Send immediately
  heartbeatInterval = setInterval(sendHeartbeat, 500); // Every 0.5 seconds
}

function stopHeartbeat(): void {
  if (heartbeatInterval) {
    log('Stopping heartbeat');
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// Check if avatar server is already running
async function isAvatarServerRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: AVATAR_PORT,
      path: '/health',
      method: 'GET',
      timeout: 1000
    }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

// Send shutdown command to Electron via HTTP
async function sendShutdownCommand(): Promise<boolean> {
  return new Promise((resolve) => {
    log('Sending shutdown command to Electron');
    const req = http.request({
      hostname: 'localhost',
      port: AVATAR_PORT,
      path: '/shutdown',
      method: 'POST',
      timeout: 2000
    }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

function promptToFilename(prompt: string, toolName?: string): string {
  // Use tool name for filename if available (more predictable)
  const baseName = toolName || prompt;
  return 'avatar_' + baseName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50) + '.png';
}

function getAvatarPath(prompt?: string, toolName?: string): string {
  if (!prompt) {
    return path.join(AVATAR_DIR, DEFAULT_AVATAR);
  }
  const filename = promptToFilename(prompt, toolName);
  const avatarPath = path.join(AVATAR_DIR, filename);
  if (fs.existsSync(avatarPath)) {
    return avatarPath;
  }
  return path.join(AVATAR_DIR, DEFAULT_AVATAR);
}

async function startElectron(avatarPath: string): Promise<void> {
  if (isShuttingDown) {
    log(`Skipping Electron start - shutting down`);
    return;
  }
  
  // Check if avatar server is already running
  const alreadyRunning = await isAvatarServerRunning();
  if (alreadyRunning) {
    log(`Avatar server already running on port ${AVATAR_PORT}, skipping spawn`);
    return;
  }
  
  // Kill any existing electron process first
  if (electronProcess) {
    log(`Killing existing Electron process before starting new one`);
    try {
      electronProcess.kill('SIGKILL');
    } catch (e) {
      // Ignore errors if process already dead
    }
    electronProcess = null;
  }
  
  log(`Starting Electron with avatar: ${avatarPath}`);
  const electronPath = path.join(AVATAR_DIR, 'node_modules', '.bin', 'electron');
  const electronEntry = path.join(AVATAR_DIR, 'dist', 'electron.js');
  log(`Electron path: ${electronPath}`);
  log(`Electron entry: ${electronEntry}`);
  log(`Electron path exists: ${fs.existsSync(electronPath)}`);
  log(`Electron entry exists: ${fs.existsSync(electronEntry)}`);
  
  const child = spawn(electronPath, [electronEntry, '--avatar', avatarPath, '--avatar-port', String(AVATAR_PORT)], {
    cwd: AVATAR_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });
  
  // Capture stdout/stderr to log file
  child.stdout?.on('data', (data) => {
    log(`[electron stdout] ${data.toString().trim()}`);
  });
  child.stderr?.on('data', (data) => {
    log(`[electron stderr] ${data.toString().trim()}`);
  });
  child.on('error', (err) => {
    log(`[electron spawn error] ${err.message}`);
  });
  child.on('exit', (code, signal) => {
    log(`[electron exit] code=${code}, signal=${signal}`);
    electronProcess = null;
  });
  
  electronProcess = child;
  log(`Electron process spawned with PID: ${child.pid}`);
}

async function shutdownElectron(): Promise<void> {
  isShuttingDown = true;
  stopHeartbeat();
  
  // Try HTTP shutdown first (works even if we didn't spawn this instance)
  const httpShutdown = await sendShutdownCommand();
  if (httpShutdown) {
    log('Electron shut down via HTTP');
    electronProcess = null;
    return;
  }
  
  // Fall back to killing the process directly
  if (electronProcess) {
    const pid = electronProcess.pid;
    log(`Shutting down Electron process via kill (PID: ${pid})`);
    try {
      electronProcess.kill('SIGKILL');
    } catch (e) {
      log(`Error killing Electron: ${e instanceof Error ? e.message : String(e)}`);
    }
    electronProcess = null;
  }
}

// Register cleanup handlers
process.on('exit', () => {
  log('Process exit event');
  shutdownElectron();
});

process.on('beforeExit', () => {
  log('Process beforeExit event');
  shutdownElectron();
});

process.on('SIGINT', () => {
  log('SIGINT received');
  shutdownElectron();
});

process.on('SIGTERM', () => {
  log('SIGTERM received');
  shutdownElectron();
});

process.on('uncaughtException', (err) => {
  log(`Uncaught exception: ${err.message}`);
  shutdownElectron();
});

async function setAvatarViaHttp(prompt?: string, toolName?: string): Promise<void> {
  const avatarPath = getAvatarPath(prompt, toolName);
  log(`setAvatarViaHttp called with prompt: ${prompt || '(default)'}, toolName: ${toolName || 'none'}, avatarPath: ${avatarPath}`);
  if (avatarPath === currentAvatar) {
    log(`Avatar unchanged, skipping update`);
    return;
  }
  currentAvatar = avatarPath;

  return new Promise((resolve) => {
    log(`Sending HTTP request to set avatar`);
    const req = http.request({
      hostname: 'localhost',
      port: AVATAR_PORT,
      path: '/set-avatar',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, () => {
      log(`Set avatar request completed successfully`);
      resolve();
    });
    req.on('error', (err) => {
      log(`Set avatar request failed: ${err.message}`);
      resolve();
    });
    req.write(JSON.stringify({ avatarPath }));
    req.end();
  });
}


export const AvatarPlugin: Plugin = async ({ client }) => {
  log(`========== Plugin initializing ==========`);

  // Function to get tool description if available
  const getToolDescription = (toolName: string): string | undefined => {
    try {
      // Try to get tool info from client
      const toolInfo = (client as any).tools?.[toolName];
      if (toolInfo?.description) {
        return toolInfo.description;
      }
      // Try other ways to access tool info
      const tools = (client as any).getTools?.() || {};
      if (tools[toolName]?.description) {
        return tools[toolName].description;
      }
    } catch (e) {
      log(`Could not get tool description for ${toolName}: ${e}`);
    }
    return undefined;
  };

  const showInfoToast = (message: string) => {
    log(`Info toast: ${message}`);
    client.tui.showToast({
      body: {
        message,
        variant: "info",
      },
    });
  };

  const showErrorToast = (message: string) => {
    log(`Error toast: ${message}`);
    client.tui.showToast({
      body: {
        message,
        variant: "error",
      },
    });
  };

  async function requestAvatarGeneration(prompt: string, showToasts = true, toolName?: string): Promise<void> {
    log(`requestAvatarGeneration called with prompt: "${prompt}", showToasts: ${showToasts}, toolName: ${toolName || 'none'}`);

    if (showToasts) {
      showInfoToast(`Generating avatar: ${prompt}`);
    }

    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: AVATAR_PORT,
        path: '/generate-avatar',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          // Reset tool active flag when tool avatar generation completes
          if (!showToasts) {
            isToolActive = false;
          }

          if (res.statusCode === 200) {
            log(`Avatar generation succeeded for prompt: "${prompt}"`);
            if (showToasts) {
              showInfoToast(`Avatar ready: ${prompt}`);
            }
            // Set the avatar with the tool name for proper filename
            setAvatarViaHttp(prompt, toolName);
            resolve();
          } else {
            log(`Avatar generation failed: ${data}`);
            if (showToasts) {
              showErrorToast(`Avatar failed: ${data}`);
            }
            reject(new Error(`Failed to generate avatar: ${data}`));
          }
        });
      });
      req.on('error', (err) => {
        log(`Avatar generation request error: ${err.message}`);
        if (showToasts) {
          showErrorToast(`Avatar generation error: ${err.message}`);
        }
        reject(err);
      });
      req.write(JSON.stringify({ prompt }));
      req.end();
    });
  }

  // Start Electron on plugin load
  try {
    const initialAvatar = getAvatarPath();
    log(`Initial avatar path: ${initialAvatar}`);
    log(`Avatar file exists: ${fs.existsSync(initialAvatar)}`);
    await startElectron(initialAvatar);
    startHeartbeat();
    showInfoToast("Avatar started");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log(`Failed to start avatar: ${message}`);
    showErrorToast(`Failed to start avatar: ${message}`);
  }

  log(`Plugin initialization complete, returning hooks`);
  
  return {
    "chat.message": async (input, output) => {
      log(`chat.message hook triggered, messageID: ${input.messageID}`);
      const userMessage = output.parts.find(
        (part) => part.type === "text" && part.messageID === input.messageID
      ) as { text: string } | undefined;

      log(`User message found: ${!!userMessage}, isThinking: ${isThinking}`);
      if (userMessage?.text) {
        log(`User message text: "${userMessage.text.substring(0, 100)}..."`);
      }

      if (userMessage?.text && !isThinking) {
        isThinking = true;
        log(`Setting isThinking=true, requesting avatar generation`);
        await requestAvatarGeneration(THINKING_PROMPT);
      }
    },

    "tool.execute.before": async (input) => {
      const toolName = input.tool;
      log(`tool.execute.before: ${toolName}`);
      log(`Tool input available: ${JSON.stringify(input)}`);

      // Try to get tool description for better prompt
      const toolDescription = getToolDescription(toolName);
      log(`Tool description: ${toolDescription || 'none found'}`);

      const prompt = getToolPrompt(toolName, toolDescription);
      log(`Using prompt: "${prompt}"`);

      isToolActive = true;

      // Don't await - fire and forget so we don't block tool execution
      requestAvatarGeneration(prompt, false, toolName).catch((err) => {
        log(`Failed to generate avatar for tool ${toolName}: ${err.message}`);
        isToolActive = false;
      });
    },

    event: async ({ event }) => {
      log(`Event received: ${event.type}`);
      if (event.type === "session.idle" && (isThinking || isToolActive)) {
        isThinking = false;
        isToolActive = false;
        log(`Session idle, resetting avatar`);
        await setAvatarViaHttp();
      }
    },
  };
};

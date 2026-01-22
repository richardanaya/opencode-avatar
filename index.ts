import { type Plugin } from "@opencode-ai/plugin";
import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import * as http from "http";
import * as fs from "fs";

const AVATAR_DIR = __dirname;
const DEFAULT_AVATAR = "avatar.png";
const THINKING_PROMPT = "thinking hard";
const AVATAR_PORT = 47291;

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
  sendHeartbeat(); // Send immediately
  heartbeatInterval = setInterval(sendHeartbeat, 500); // Every 0.5 seconds
}

function stopHeartbeat(): void {
  if (heartbeatInterval) {
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
    return;
  }
  
  // Check if avatar server is already running
  const alreadyRunning = await isAvatarServerRunning();
  if (alreadyRunning) {
    return;
  }
  
  // Kill any existing electron process first
  if (electronProcess) {
    try {
      electronProcess.kill('SIGKILL');
    } catch (e) {
      // Ignore errors if process already dead
    }
    electronProcess = null;
  }
  
  const electronPath = path.join(AVATAR_DIR, 'node_modules', '.bin', 'electron');
  const electronEntry = path.join(AVATAR_DIR, 'dist', 'electron.js');
  
  const child = spawn(electronPath, [electronEntry, '--avatar', avatarPath, '--avatar-port', String(AVATAR_PORT)], {
    cwd: AVATAR_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });
  
  // Capture stdout/stderr to log file
  child.stdout?.on('data', (data) => {
  });
  child.stderr?.on('data', (data) => {
  });
  child.on('error', (err) => {
  });
  child.on('exit', (code, signal) => {
    electronProcess = null;
  });
  
  electronProcess = child;
}

async function shutdownElectron(): Promise<void> {
  isShuttingDown = true;
  stopHeartbeat();
  
  // Try HTTP shutdown first (works even if we didn't spawn this instance)
  const httpShutdown = await sendShutdownCommand();
  if (httpShutdown) {
    electronProcess = null;
    return;
  }
  
  // Fall back to killing the process directly
  if (electronProcess) {
    const pid = electronProcess.pid;
    try {
      electronProcess.kill('SIGKILL');
    } catch (e) {
    }
    electronProcess = null;
  }
}

// Register cleanup handlers
process.on('exit', () => {
  shutdownElectron();
});

process.on('beforeExit', () => {
  shutdownElectron();
});

process.on('SIGINT', () => {
  shutdownElectron();
});

process.on('SIGTERM', () => {
  shutdownElectron();
});

process.on('uncaughtException', (err) => {
  shutdownElectron();
});

async function setAvatarViaHttp(prompt?: string, toolName?: string): Promise<void> {
  const avatarPath = getAvatarPath(prompt, toolName);
  if (avatarPath === currentAvatar) {
    return;
  }
  currentAvatar = avatarPath;

  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: AVATAR_PORT,
      path: '/set-avatar',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, () => {
      resolve();
    });
    req.on('error', (err) => {
      resolve();
    });
    req.write(JSON.stringify({ avatarPath }));
    req.end();
  });
}


export const AvatarPlugin: Plugin = async ({ client }) => {

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
    }
    return undefined;
  };

  const showInfoToast = (message: string) => {
    client.tui.showToast({
      body: {
        message,
        variant: "info",
      },
    });
  };

  const showErrorToast = (message: string) => {
    client.tui.showToast({
      body: {
        message,
        variant: "error",
      },
    });
  };

  async function requestAvatarGeneration(prompt: string, showToasts = true, toolName?: string): Promise<void> {

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
            if (showToasts) {
              showInfoToast(`Avatar ready: ${prompt}`);
            }
            // Set the avatar with the tool name for proper filename
            setAvatarViaHttp(prompt, toolName);
            resolve();
          } else {
            if (showToasts) {
              showErrorToast(`Avatar failed: ${data}`);
            }
            reject(new Error(`Failed to generate avatar: ${data}`));
          }
        });
      });
      req.on('error', (err) => {
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
    await startElectron(initialAvatar);
    startHeartbeat();
    showInfoToast("Avatar started");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    showErrorToast(`Failed to start avatar: ${message}`);
  }

  
  return {
    "chat.message": async (input, output) => {
      const userMessage = output.parts.find(
        (part) => part.type === "text" && part.messageID === input.messageID
      ) as { text: string } | undefined;

      if (userMessage?.text) {
      }

      if (userMessage?.text && !isThinking) {
        isThinking = true;
        await requestAvatarGeneration(THINKING_PROMPT);
      }
    },

    "tool.execute.before": async (input) => {
      const toolName = input.tool;

      // Try to get tool description for better prompt
      const toolDescription = getToolDescription(toolName);

      const prompt = getToolPrompt(toolName, toolDescription);

      isToolActive = true;

      // Don't await - fire and forget so we don't block tool execution
      requestAvatarGeneration(prompt, false, toolName).catch((err) => {
        isToolActive = false;
      });
    },

    event: async ({ event }) => {
      if (event.type === "session.idle" && (isThinking || isToolActive)) {
        isThinking = false;
        isToolActive = false;
        await setAvatarViaHttp();
      }
    },
  };
};

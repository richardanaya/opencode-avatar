// @bun
// index.ts
import { spawn } from "child_process";
import * as path from "path";
import * as http from "http";
import * as fs from "fs";
import * as os from "os";
var __dirname = "/var/home/wizard/av";
var AVATAR_DIR = __dirname;
var DEFAULT_AVATAR = "avatar.png";
var USER_AVATAR = path.join(os.homedir(), ".config", "opencode", "avatar.png");
var THINKING_PROMPT = "thinking hard";
var AVATAR_PORT = 47291;
function getToolPrompt(toolName, toolDescription) {
  if (toolDescription) {
    const shortDesc = toolDescription.split(".")[0].substring(0, 50);
    return `${toolName} - ${shortDesc}`;
  }
  return toolName;
}
var electronProcess = null;
var currentAvatar = getAvatarPath();
var isThinking = false;
var isToolActive = false;
var isShuttingDown = false;
var idleTriggered = false;
var currentRequestId = null;
var heartbeatInterval = null;
function sendHeartbeat() {
  const req = http.request({
    hostname: "localhost",
    port: AVATAR_PORT,
    path: "/heartbeat",
    method: "POST",
    timeout: 1000
  }, () => {});
  req.on("error", () => {});
  req.on("timeout", () => req.destroy());
  req.end();
}
function startHeartbeat() {
  if (heartbeatInterval)
    return;
  sendHeartbeat();
  heartbeatInterval = setInterval(sendHeartbeat, 500);
}
function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}
async function isAvatarServerRunning() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: "localhost",
      port: AVATAR_PORT,
      path: "/health",
      method: "GET",
      timeout: 1000
    }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}
async function sendShutdownCommand() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: "localhost",
      port: AVATAR_PORT,
      path: "/shutdown",
      method: "POST",
      timeout: 2000
    }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}
function promptToFilename(prompt, toolName) {
  const baseName = toolName || prompt;
  return "avatar_" + baseName.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, "_").substring(0, 50) + ".png";
}
function getAvatarPath(prompt, toolName) {
  if (!prompt) {
    if (fs.existsSync(USER_AVATAR)) {
      return USER_AVATAR;
    }
    return path.join(AVATAR_DIR, DEFAULT_AVATAR);
  }
  const filename = promptToFilename(prompt, toolName);
  const avatarPath = path.join(AVATAR_DIR, filename);
  if (fs.existsSync(avatarPath)) {
    return avatarPath;
  }
  return path.join(AVATAR_DIR, DEFAULT_AVATAR);
}
async function startElectron(avatarPath) {
  if (isShuttingDown) {
    return;
  }
  const alreadyRunning = await isAvatarServerRunning();
  if (alreadyRunning) {
    return;
  }
  if (electronProcess) {
    try {
      electronProcess.kill("SIGKILL");
    } catch (e) {}
    electronProcess = null;
  }
  const electronPath = path.join(AVATAR_DIR, "node_modules", ".bin", "electron");
  const electronEntry = path.join(AVATAR_DIR, "dist", "electron.js");
  const child = spawn(electronPath, [electronEntry, "--avatar", avatarPath, "--avatar-port", String(AVATAR_PORT)], {
    cwd: AVATAR_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false
  });
  child.stdout?.on("data", (data) => {});
  child.stderr?.on("data", (data) => {});
  child.on("error", (err) => {});
  child.on("exit", (code, signal) => {
    electronProcess = null;
  });
  electronProcess = child;
}
async function shutdownElectron() {
  isShuttingDown = true;
  stopHeartbeat();
  const httpShutdown = await sendShutdownCommand();
  if (httpShutdown) {
    electronProcess = null;
    return;
  }
  if (electronProcess) {
    const pid = electronProcess.pid;
    try {
      electronProcess.kill("SIGKILL");
    } catch (e) {}
    electronProcess = null;
  }
}
process.on("exit", () => {
  shutdownElectron();
});
process.on("beforeExit", () => {
  shutdownElectron();
});
process.on("SIGINT", () => {
  shutdownElectron();
});
process.on("SIGTERM", () => {
  shutdownElectron();
});
process.on("uncaughtException", (err) => {
  shutdownElectron();
});
async function setAvatarViaHttp(prompt, toolName) {
  const avatarPath = getAvatarPath(prompt, toolName);
  if (avatarPath === currentAvatar) {
    return;
  }
  currentAvatar = avatarPath;
  return new Promise((resolve) => {
    const req = http.request({
      hostname: "localhost",
      port: AVATAR_PORT,
      path: "/set-avatar",
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, () => {
      resolve();
    });
    req.on("error", (err) => {
      resolve();
    });
    req.write(JSON.stringify({ avatarPath }));
    req.end();
  });
}
var AvatarPlugin = async ({ client }) => {
  const getToolDescription = (toolName) => {
    try {
      const toolInfo = client.tools?.[toolName];
      if (toolInfo?.description) {
        return toolInfo.description;
      }
      const tools = client.getTools?.() || {};
      if (tools[toolName]?.description) {
        return tools[toolName].description;
      }
    } catch (e) {}
    return;
  };
  const showInfoToast = (message) => {
    client.tui.showToast({
      body: {
        message,
        variant: "info"
      }
    });
  };
  const showErrorToast = (message) => {
    client.tui.showToast({
      body: {
        message,
        variant: "error"
      }
    });
  };
  async function requestAvatarGeneration(prompt, showToasts = true, toolName) {
    const requestId = `${Date.now()}-${Math.random()}`;
    currentRequestId = requestId;
    if (showToasts) {
      showInfoToast(`Generating avatar: ${prompt}`);
    }
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: "localhost",
        port: AVATAR_PORT,
        path: "/generate-avatar",
        method: "POST",
        headers: { "Content-Type": "application/json" }
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk);
        res.on("end", () => {
          if (!showToasts) {
            isToolActive = false;
            isThinking = false;
          }
          if (res.statusCode === 200) {
            if (showToasts) {
              showInfoToast(`Avatar ready: ${prompt}`);
            }
            if (currentRequestId === requestId) {
              setAvatarViaHttp(prompt, toolName);
            }
            resolve();
          } else {
            if (showToasts) {
              showErrorToast(`Avatar failed: ${data}`);
            }
            reject(new Error(`Failed to generate avatar: ${data}`));
          }
        });
      });
      req.on("error", (err) => {
        if (showToasts) {
          showErrorToast(`Avatar generation error: ${err.message}`);
        }
        reject(err);
      });
      req.write(JSON.stringify({ prompt }));
      req.end();
    });
  }
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
      const userMessage = output.parts.find((part) => part.type === "text" && part.messageID === input.messageID);
      if (userMessage?.text) {}
      if (userMessage?.text && !isThinking) {
        idleTriggered = false;
        isThinking = true;
        requestAvatarGeneration(THINKING_PROMPT, false).catch(() => {
          isThinking = false;
        });
      }
    },
    "tool.execute.before": async (input) => {
      const toolName = input.tool;
      const toolDescription = getToolDescription(toolName);
      const prompt = getToolPrompt(toolName, toolDescription);
      idleTriggered = false;
      isToolActive = true;
      requestAvatarGeneration(prompt, false, toolName).catch((err) => {
        isToolActive = false;
      });
    },
    event: async ({ event }) => {
      if (event.type === "session.idle" && (isThinking || isToolActive)) {
        idleTriggered = true;
        isThinking = false;
        isToolActive = false;
        currentRequestId = null;
        await setAvatarViaHttp();
      }
    }
  };
};
export {
  AvatarPlugin
};

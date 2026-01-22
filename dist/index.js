// @bun
// index.ts
import { spawn } from "child_process";
import * as path from "path";
import * as http from "http";
import * as fs from "fs";
var __dirname = "/var/home/wizard/opencode-avatar";
var AVATAR_DIR = __dirname;
var DEFAULT_AVATAR = "avatar.png";
var THINKING_PROMPT = "thinking hard";
var AVATAR_PORT = 47291;
var LOG_FILE = path.join(AVATAR_DIR, "avatar.log");
var LOCK_FILE = path.join(AVATAR_DIR, ".avatar.lock");
function getToolPrompt(toolName, toolDescription) {
  if (toolDescription) {
    const shortDesc = toolDescription.split(".")[0].substring(0, 50);
    return `${toolName} - ${shortDesc}`;
  }
  return toolName;
}
function log(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [plugin] ${message}
`;
  fs.appendFileSync(LOG_FILE, logLine);
}
var electronProcess = null;
var currentAvatar = DEFAULT_AVATAR;
var isThinking = false;
var isToolActive = false;
var isShuttingDown = false;
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
  log("Starting heartbeat");
  sendHeartbeat();
  heartbeatInterval = setInterval(sendHeartbeat, 500);
}
function stopHeartbeat() {
  if (heartbeatInterval) {
    log("Stopping heartbeat");
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
    log("Sending shutdown command to Electron");
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
    log(`Skipping Electron start - shutting down`);
    return;
  }
  const alreadyRunning = await isAvatarServerRunning();
  if (alreadyRunning) {
    log(`Avatar server already running on port ${AVATAR_PORT}, skipping spawn`);
    return;
  }
  if (electronProcess) {
    log(`Killing existing Electron process before starting new one`);
    try {
      electronProcess.kill("SIGKILL");
    } catch (e) {}
    electronProcess = null;
  }
  log(`Starting Electron with avatar: ${avatarPath}`);
  const electronPath = path.join(AVATAR_DIR, "node_modules", ".bin", "electron");
  const electronEntry = path.join(AVATAR_DIR, "dist", "electron.js");
  log(`Electron path: ${electronPath}`);
  log(`Electron entry: ${electronEntry}`);
  log(`Electron path exists: ${fs.existsSync(electronPath)}`);
  log(`Electron entry exists: ${fs.existsSync(electronEntry)}`);
  const child = spawn(electronPath, [electronEntry, "--avatar", avatarPath, "--avatar-port", String(AVATAR_PORT)], {
    cwd: AVATAR_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false
  });
  child.stdout?.on("data", (data) => {
    log(`[electron stdout] ${data.toString().trim()}`);
  });
  child.stderr?.on("data", (data) => {
    log(`[electron stderr] ${data.toString().trim()}`);
  });
  child.on("error", (err) => {
    log(`[electron spawn error] ${err.message}`);
  });
  child.on("exit", (code, signal) => {
    log(`[electron exit] code=${code}, signal=${signal}`);
    electronProcess = null;
  });
  electronProcess = child;
  log(`Electron process spawned with PID: ${child.pid}`);
}
async function shutdownElectron() {
  isShuttingDown = true;
  stopHeartbeat();
  const httpShutdown = await sendShutdownCommand();
  if (httpShutdown) {
    log("Electron shut down via HTTP");
    electronProcess = null;
    return;
  }
  if (electronProcess) {
    const pid = electronProcess.pid;
    log(`Shutting down Electron process via kill (PID: ${pid})`);
    try {
      electronProcess.kill("SIGKILL");
    } catch (e) {
      log(`Error killing Electron: ${e instanceof Error ? e.message : String(e)}`);
    }
    electronProcess = null;
  }
}
process.on("exit", () => {
  log("Process exit event");
  shutdownElectron();
});
process.on("beforeExit", () => {
  log("Process beforeExit event");
  shutdownElectron();
});
process.on("SIGINT", () => {
  log("SIGINT received");
  shutdownElectron();
});
process.on("SIGTERM", () => {
  log("SIGTERM received");
  shutdownElectron();
});
process.on("uncaughtException", (err) => {
  log(`Uncaught exception: ${err.message}`);
  shutdownElectron();
});
async function setAvatarViaHttp(prompt, toolName) {
  const avatarPath = getAvatarPath(prompt, toolName);
  log(`setAvatarViaHttp called with prompt: ${prompt || "(default)"}, toolName: ${toolName || "none"}, avatarPath: ${avatarPath}`);
  if (avatarPath === currentAvatar) {
    log(`Avatar unchanged, skipping update`);
    return;
  }
  currentAvatar = avatarPath;
  return new Promise((resolve) => {
    log(`Sending HTTP request to set avatar`);
    const req = http.request({
      hostname: "localhost",
      port: AVATAR_PORT,
      path: "/set-avatar",
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, () => {
      log(`Set avatar request completed successfully`);
      resolve();
    });
    req.on("error", (err) => {
      log(`Set avatar request failed: ${err.message}`);
      resolve();
    });
    req.write(JSON.stringify({ avatarPath }));
    req.end();
  });
}
var AvatarPlugin = async ({ client }) => {
  log(`========== Plugin initializing ==========`);
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
    } catch (e) {
      log(`Could not get tool description for ${toolName}: ${e}`);
    }
    return;
  };
  const showInfoToast = (message) => {
    log(`Info toast: ${message}`);
    client.tui.showToast({
      body: {
        message,
        variant: "info"
      }
    });
  };
  const showErrorToast = (message) => {
    log(`Error toast: ${message}`);
    client.tui.showToast({
      body: {
        message,
        variant: "error"
      }
    });
  };
  async function requestAvatarGeneration(prompt, showToasts = true, toolName) {
    log(`requestAvatarGeneration called with prompt: "${prompt}", showToasts: ${showToasts}, toolName: ${toolName || "none"}`);
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
          }
          if (res.statusCode === 200) {
            log(`Avatar generation succeeded for prompt: "${prompt}"`);
            if (showToasts) {
              showInfoToast(`Avatar ready: ${prompt}`);
            }
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
      req.on("error", (err) => {
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
      const userMessage = output.parts.find((part) => part.type === "text" && part.messageID === input.messageID);
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
      const toolDescription = getToolDescription(toolName);
      log(`Tool description: ${toolDescription || "none found"}`);
      const prompt = getToolPrompt(toolName, toolDescription);
      log(`Using prompt: "${prompt}"`);
      isToolActive = true;
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
    }
  };
};
export {
  AvatarPlugin
};

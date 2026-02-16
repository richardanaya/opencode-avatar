import { type Plugin } from "@opencode-ai/plugin";
import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import { Database } from "bun:sqlite";
import type { createOpencodeClient } from "@opencode-ai/sdk";

const PLUGIN_DIR = __dirname; // Where the plugin code lives
const AVATAR_DIR = path.join(os.homedir(), '.config', 'opencode'); // Where avatars are stored
const DEFAULT_AVATAR = "avatar.png";
const THINKING_PROMPT = "thinking hard";
const AVATAR_PORT = 47291;

// =============================================================================
// Database
// =============================================================================

let dbFile: string | null = null;
let db: Database | null = null;

async function getDbFile(
  client: ReturnType<typeof createOpencodeClient>,
): Promise<string> {
  if (!dbFile) {
    const result = await client.path.get();
    dbFile = path.join(result.data!.config, "avatar.db");
  }
  return dbFile;
}

async function getDatabase(
  client: ReturnType<typeof createOpencodeClient>,
): Promise<Database> {
  if (!db) {
    const file = await getDbFile(client);
    db = new Database(file);

    // Enable WAL mode for better concurrency
    db.run("PRAGMA journal_mode = WAL");

    // Create table to track latest tool usage per name/session
    db.exec(`
      CREATE TABLE IF NOT EXISTS latest_tool_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        UNIQUE(name, session_id)
      )
    `);

    // Create index for fast lookups
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tool_usage_name_session ON latest_tool_usage(name, session_id)
    `);
  }
  return db;
}

async function registerAvatarName(
  client: ReturnType<typeof createOpencodeClient>,
  name: string,
  sessionId: string,
): Promise<void> {
  const database = await getDatabase(client);
  const stmt = database.prepare(`
    INSERT INTO latest_tool_usage (name, session_id, tool_name, timestamp)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name, session_id) DO UPDATE SET
      tool_name = excluded.tool_name,
      timestamp = excluded.timestamp
  `);
  stmt.run(name.toLowerCase(), sessionId, "registered", Date.now());
}

async function updateToolUsage(
  client: ReturnType<typeof createOpencodeClient>,
  name: string,
  sessionId: string,
  toolName: string,
): Promise<void> {
  const database = await getDatabase(client);
  const stmt = database.prepare(`
    INSERT INTO latest_tool_usage (name, session_id, tool_name, timestamp)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name, session_id) DO UPDATE SET
      tool_name = excluded.tool_name,
      timestamp = excluded.timestamp
  `);
  stmt.run(name.toLowerCase(), sessionId, toolName, Date.now());
}

async function getLatestToolUsage(
  client: ReturnType<typeof createOpencodeClient>,
  name: string,
): Promise<{ name: string; session_id: string; tool_name: string; timestamp: number } | null> {
  const database = await getDatabase(client);
  const stmt = database.prepare(`
    SELECT name, session_id, tool_name, timestamp
    FROM latest_tool_usage
    WHERE name = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `);
  const result = stmt.get(name.toLowerCase()) as { name: string; session_id: string; tool_name: string; timestamp: number } | undefined;
  return result || null;
}

// Normalize agent name: lowercase and spaces to underscores
function normalizeAgentName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_');
}

// Get the avatar base for a given agent name
// Returns 'avatar-<agent_name>' if avatar-<agent_name>.png exists, otherwise 'avatar'
function getAgentAvatarBase(agentName?: string | null): string {
  if (!agentName) return 'avatar';
  const normalized = normalizeAgentName(agentName);
  const agentAvatarPath = path.join(AVATAR_DIR, `avatar-${normalized}.png`);
  if (fs.existsSync(agentAvatarPath)) {
    return `avatar-${normalized}`;
  }
  return 'avatar';
}

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
let currentAvatar: string = getAvatarPath();
let isThinking = false;
let isToolActive = false;
let isShuttingDown = false;
let idleTriggered = false;
let currentRequestId: string | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

// Agent tracking - detected from message events
let currentAgentName: string | null = null;
let currentAgentBase: string = 'avatar'; // Will be updated when agent is detected

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

function promptToFilename(prompt: string, toolName?: string, agentBase?: string): string {
  // Use tool name for filename if available (more predictable)
  const base = agentBase || 'avatar';
  const baseName = toolName || prompt;
  const action = baseName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
  // Format: avatar-action.png or avatar-agent_name-action.png
  return `${base}-${action}.png`;
}

function getAvatarPath(prompt?: string, toolName?: string, agentBase?: string): string {
  // Use agent-specific base avatar if available
  const base = agentBase || currentAgentBase;
  const defaultAvatar = path.join(AVATAR_DIR, `${base}.png`);
  
  // If no prompt, return the base avatar (agent-specific or default)
  if (!prompt) {
    // Fall back to standard avatar.png if agent-specific base doesn't exist
    if (!fs.existsSync(defaultAvatar)) {
      return path.join(AVATAR_DIR, DEFAULT_AVATAR);
    }
    return defaultAvatar;
  }
  
  const filename = promptToFilename(prompt, toolName, base);
  const avatarPath = path.join(AVATAR_DIR, filename);
  if (fs.existsSync(avatarPath)) {
    return avatarPath;
  }
  
  // Fall back to base avatar, then standard default
  if (fs.existsSync(defaultAvatar)) {
    return defaultAvatar;
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
  
  const electronPath = path.join(PLUGIN_DIR, 'node_modules', '.bin', 'electron');
  const electronEntry = path.join(PLUGIN_DIR, 'dist', 'electron.js');

  const child = spawn(electronPath, [electronEntry, '--avatar', avatarPath, '--avatar-port', String(AVATAR_PORT)], {
    cwd: PLUGIN_DIR,
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

async function setAvatarViaHttp(prompt?: string, toolName?: string, force?: boolean): Promise<void> {
  const avatarPath = getAvatarPath(prompt, toolName);
  if (!force && avatarPath === currentAvatar) {
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
  // Import tool helper
  const { tool } = await import("@opencode-ai/plugin");
  const z = tool.schema;

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
    const requestId = `${Date.now()}-${Math.random()}`;
    currentRequestId = requestId;

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
          if (res.statusCode === 200) {
            if (showToasts) {
              showInfoToast(`Avatar ready: ${prompt}`);
            }
            // Only set avatar if this request is still the current one
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
      req.on('error', (err) => {
        if (showToasts) {
          showErrorToast(`Avatar generation error: ${err.message}`);
        }
        reject(err);
      });
      // Pass agentBase to electron for generation
      req.write(JSON.stringify({ prompt, agentBase: currentAgentBase }));
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

  // Create the register_avatar_name tool
  const registerAvatarNameTool = tool({
    description:
      "Register a name for this avatar session. This associates a name with the current session ID for tracking purposes.",
    args: {
      name: z
        .string()
        .describe(
          "Name to register for this avatar session. This will be associated with the current session ID.",
        ),
    },
    async execute(args, toolCtx) {
      const name = args.name.toLowerCase();
      const sessionId = toolCtx.sessionID;

      try {
        await registerAvatarName(client, name, sessionId);
        return `Avatar name "${args.name}" registered for session ${sessionId}`;
      } catch (error) {
        console.error(`[Avatar] Failed to register name:`, error);
        throw error;
      }
    },
  });

  // Define all hooks
  const hooks = {
    "chat.message": async (input: any, output: any) => {
      console.log(`[Avatar DEBUG] chat.message hook - input keys: ${Object.keys(input).join(', ')}, output keys: ${Object.keys(output).join(', ')}`);
      
      const userMessage = output.parts.find(
        (part: any) => part.type === "text" && part.messageID === input.messageID
      ) as { text: string } | undefined;

      if (userMessage?.text) {
      }

      if (userMessage?.text && !isThinking) {
        idleTriggered = false;
        isThinking = true;
        
        // Track thinking state in database
        // Try to find session ID in various places
        const sessionId = input.sessionID || output.sessionID || currentAgentName || "unknown-session";
        const trackingName = currentAgentName || sessionId;
        
        console.log(`[Avatar] Tracking THINKING state - sessionId: ${sessionId}, trackingName: ${trackingName}`);
        
        updateToolUsage(client, trackingName, sessionId, "thinking").catch((err) => {
          console.error(`[Avatar] Failed to update thinking state:`, err);
        });
        
        // Don't await - fire and forget so we don't block chat response
        requestAvatarGeneration(THINKING_PROMPT, false).catch(() => {
          isThinking = false;
        });
      }
    },

    "tool.execute.before": async (input: any) => {
      const toolName = input.tool;
      
      // Get session ID from input context - this should be provided by the plugin system
      // Fall back to agent name or a generated identifier based on tool name
      const sessionId = input.sessionID || input.sessionId || currentAgentName || `session-${Date.now()}`;
      
      // Use registered name if available, otherwise use session ID as the tracking name
      const trackingName = currentAgentName || sessionId;
      
      console.log(`[Avatar] Tool executing: ${toolName}, sessionId: ${sessionId}, trackingName: ${trackingName}`);
      
      // Track tool usage in database (fire and forget)
      updateToolUsage(client, trackingName, sessionId, toolName).catch((err) => {
        console.error(`[Avatar] Failed to update tool usage:`, err);
      });

      // Try to get tool description for better prompt
      const toolDescription = getToolDescription(toolName);

      const prompt = getToolPrompt(toolName, toolDescription);

      idleTriggered = false;
      isToolActive = true;

      const avatarPath = getAvatarPath(prompt, toolName);
      if (fs.existsSync(avatarPath)) {
        setAvatarViaHttp(prompt, toolName, true);
      }

      requestAvatarGeneration(prompt, false, toolName).catch((err) => {
        isToolActive = false;
      });
    },

    event: async ({ event }: { event: any }) => {
      console.log(`[Avatar DEBUG] event hook - event.type: ${event.type}, event keys: ${Object.keys(event).join(', ')}`);
      
      // Detect agent from user messages
      if (event.type === "message.updated") {
        const message = (event as any).properties?.info;
        if (message?.role === "user" && message?.agent) {
          const agentName = message.agent as string;
          if (currentAgentName !== agentName) {
            currentAgentName = agentName;
            currentAgentBase = getAgentAvatarBase(currentAgentName);
          }
        }
      }
      
      if (event.type === "session.idle" && (isThinking || isToolActive)) {
        idleTriggered = true;
        isThinking = false;
        isToolActive = false;
        currentRequestId = null; // Invalidate any ongoing avatar generation
        
        // Track idle state in database
        const sessionId = event.sessionID || event.sessionId || currentAgentName || "unknown-session";
        const trackingName = currentAgentName || sessionId;
        
        console.log(`[Avatar] Tracking IDLE state - sessionId: ${sessionId}, trackingName: ${trackingName}`);
        
        updateToolUsage(client, trackingName, sessionId, "idle").catch((err) => {
          console.error(`[Avatar] Failed to update idle state:`, err);
        });
        
        // Force the reset because Electron may have changed the displayed avatar
        // via /generate-avatar before we could cancel it
        await setAvatarViaHttp(undefined, undefined, true);
      }
    },

    // Hook: Clean up database connection when session ends
    "session.end": async (_input: { sessionID: string }) => {
      // Database cleanup if needed
    },
  };

  // Return plugin structure with tools, config, and hooks
  return {
    tool: {
      register_avatar_name: registerAvatarNameTool,
    },

    // Hook: Add tools to primary_tools config
    config: async (input: {
      experimental?: { primary_tools?: string[]; [key: string]: unknown };
      [key: string]: unknown;
    }) => {
      input.experimental ??= {};
      input.experimental.primary_tools ??= [];
      input.experimental.primary_tools.push("register_avatar_name");
    },

    hooks,
  };
};

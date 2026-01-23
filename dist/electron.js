import { createRequire } from "node:module";
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// node_modules/dotenv/package.json
var require_package = __commonJS((exports, module) => {
  module.exports = {
    name: "dotenv",
    version: "17.2.3",
    description: "Loads environment variables from .env file",
    main: "lib/main.js",
    types: "lib/main.d.ts",
    exports: {
      ".": {
        types: "./lib/main.d.ts",
        require: "./lib/main.js",
        default: "./lib/main.js"
      },
      "./config": "./config.js",
      "./config.js": "./config.js",
      "./lib/env-options": "./lib/env-options.js",
      "./lib/env-options.js": "./lib/env-options.js",
      "./lib/cli-options": "./lib/cli-options.js",
      "./lib/cli-options.js": "./lib/cli-options.js",
      "./package.json": "./package.json"
    },
    scripts: {
      "dts-check": "tsc --project tests/types/tsconfig.json",
      lint: "standard",
      pretest: "npm run lint && npm run dts-check",
      test: "tap run tests/**/*.js --allow-empty-coverage --disable-coverage --timeout=60000",
      "test:coverage": "tap run tests/**/*.js --show-full-coverage --timeout=60000 --coverage-report=text --coverage-report=lcov",
      prerelease: "npm test",
      release: "standard-version"
    },
    repository: {
      type: "git",
      url: "git://github.com/motdotla/dotenv.git"
    },
    homepage: "https://github.com/motdotla/dotenv#readme",
    funding: "https://dotenvx.com",
    keywords: [
      "dotenv",
      "env",
      ".env",
      "environment",
      "variables",
      "config",
      "settings"
    ],
    readmeFilename: "README.md",
    license: "BSD-2-Clause",
    devDependencies: {
      "@types/node": "^18.11.3",
      decache: "^4.6.2",
      sinon: "^14.0.1",
      standard: "^17.0.0",
      "standard-version": "^9.5.0",
      tap: "^19.2.0",
      typescript: "^4.8.4"
    },
    engines: {
      node: ">=12"
    },
    browser: {
      fs: false
    }
  };
});

// node_modules/dotenv/lib/main.js
var require_main = __commonJS((exports, module) => {
  var fs = __require("fs");
  var path = __require("path");
  var os = __require("os");
  var crypto = __require("crypto");
  var packageJson = require_package();
  var version = packageJson.version;
  var TIPS = [
    "\uD83D\uDD10 encrypt with Dotenvx: https://dotenvx.com",
    "\uD83D\uDD10 prevent committing .env to code: https://dotenvx.com/precommit",
    "\uD83D\uDD10 prevent building .env in docker: https://dotenvx.com/prebuild",
    "\uD83D\uDCE1 add observability to secrets: https://dotenvx.com/ops",
    "\uD83D\uDC65 sync secrets across teammates & machines: https://dotenvx.com/ops",
    "\uD83D\uDDC2️ backup and recover secrets: https://dotenvx.com/ops",
    "✅ audit secrets and track compliance: https://dotenvx.com/ops",
    "\uD83D\uDD04 add secrets lifecycle management: https://dotenvx.com/ops",
    "\uD83D\uDD11 add access controls to secrets: https://dotenvx.com/ops",
    "\uD83D\uDEE0️  run anywhere with `dotenvx run -- yourcommand`",
    "⚙️  specify custom .env file path with { path: '/custom/path/.env' }",
    "⚙️  enable debug logging with { debug: true }",
    "⚙️  override existing env vars with { override: true }",
    "⚙️  suppress all logs with { quiet: true }",
    "⚙️  write to custom object with { processEnv: myObject }",
    "⚙️  load multiple .env files with { path: ['.env.local', '.env'] }"
  ];
  function _getRandomTip() {
    return TIPS[Math.floor(Math.random() * TIPS.length)];
  }
  function parseBoolean(value) {
    if (typeof value === "string") {
      return !["false", "0", "no", "off", ""].includes(value.toLowerCase());
    }
    return Boolean(value);
  }
  function supportsAnsi() {
    return process.stdout.isTTY;
  }
  function dim(text) {
    return supportsAnsi() ? `\x1B[2m${text}\x1B[0m` : text;
  }
  var LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg;
  function parse(src) {
    const obj = {};
    let lines = src.toString();
    lines = lines.replace(/\r\n?/mg, `
`);
    let match;
    while ((match = LINE.exec(lines)) != null) {
      const key = match[1];
      let value = match[2] || "";
      value = value.trim();
      const maybeQuote = value[0];
      value = value.replace(/^(['"`])([\s\S]*)\1$/mg, "$2");
      if (maybeQuote === '"') {
        value = value.replace(/\\n/g, `
`);
        value = value.replace(/\\r/g, "\r");
      }
      obj[key] = value;
    }
    return obj;
  }
  function _parseVault(options) {
    options = options || {};
    const vaultPath = _vaultPath(options);
    options.path = vaultPath;
    const result = DotenvModule.configDotenv(options);
    if (!result.parsed) {
      const err = new Error(`MISSING_DATA: Cannot parse ${vaultPath} for an unknown reason`);
      err.code = "MISSING_DATA";
      throw err;
    }
    const keys = _dotenvKey(options).split(",");
    const length = keys.length;
    let decrypted;
    for (let i = 0;i < length; i++) {
      try {
        const key = keys[i].trim();
        const attrs = _instructions(result, key);
        decrypted = DotenvModule.decrypt(attrs.ciphertext, attrs.key);
        break;
      } catch (error) {
        if (i + 1 >= length) {
          throw error;
        }
      }
    }
    return DotenvModule.parse(decrypted);
  }
  function _warn(message) {
    console.error(`[dotenv@${version}][WARN] ${message}`);
  }
  function _debug(message) {
    console.log(`[dotenv@${version}][DEBUG] ${message}`);
  }
  function _log(message) {
    console.log(`[dotenv@${version}] ${message}`);
  }
  function _dotenvKey(options) {
    if (options && options.DOTENV_KEY && options.DOTENV_KEY.length > 0) {
      return options.DOTENV_KEY;
    }
    if (process.env.DOTENV_KEY && process.env.DOTENV_KEY.length > 0) {
      return process.env.DOTENV_KEY;
    }
    return "";
  }
  function _instructions(result, dotenvKey) {
    let uri;
    try {
      uri = new URL(dotenvKey);
    } catch (error) {
      if (error.code === "ERR_INVALID_URL") {
        const err = new Error("INVALID_DOTENV_KEY: Wrong format. Must be in valid uri format like dotenv://:key_1234@dotenvx.com/vault/.env.vault?environment=development");
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      }
      throw error;
    }
    const key = uri.password;
    if (!key) {
      const err = new Error("INVALID_DOTENV_KEY: Missing key part");
      err.code = "INVALID_DOTENV_KEY";
      throw err;
    }
    const environment = uri.searchParams.get("environment");
    if (!environment) {
      const err = new Error("INVALID_DOTENV_KEY: Missing environment part");
      err.code = "INVALID_DOTENV_KEY";
      throw err;
    }
    const environmentKey = `DOTENV_VAULT_${environment.toUpperCase()}`;
    const ciphertext = result.parsed[environmentKey];
    if (!ciphertext) {
      const err = new Error(`NOT_FOUND_DOTENV_ENVIRONMENT: Cannot locate environment ${environmentKey} in your .env.vault file.`);
      err.code = "NOT_FOUND_DOTENV_ENVIRONMENT";
      throw err;
    }
    return { ciphertext, key };
  }
  function _vaultPath(options) {
    let possibleVaultPath = null;
    if (options && options.path && options.path.length > 0) {
      if (Array.isArray(options.path)) {
        for (const filepath of options.path) {
          if (fs.existsSync(filepath)) {
            possibleVaultPath = filepath.endsWith(".vault") ? filepath : `${filepath}.vault`;
          }
        }
      } else {
        possibleVaultPath = options.path.endsWith(".vault") ? options.path : `${options.path}.vault`;
      }
    } else {
      possibleVaultPath = path.resolve(process.cwd(), ".env.vault");
    }
    if (fs.existsSync(possibleVaultPath)) {
      return possibleVaultPath;
    }
    return null;
  }
  function _resolveHome(envPath) {
    return envPath[0] === "~" ? path.join(os.homedir(), envPath.slice(1)) : envPath;
  }
  function _configVault(options) {
    const debug = parseBoolean(process.env.DOTENV_CONFIG_DEBUG || options && options.debug);
    const quiet = parseBoolean(process.env.DOTENV_CONFIG_QUIET || options && options.quiet);
    if (debug || !quiet) {
      _log("Loading env from encrypted .env.vault");
    }
    const parsed = DotenvModule._parseVault(options);
    let processEnv = process.env;
    if (options && options.processEnv != null) {
      processEnv = options.processEnv;
    }
    DotenvModule.populate(processEnv, parsed, options);
    return { parsed };
  }
  function configDotenv(options) {
    const dotenvPath = path.resolve(process.cwd(), ".env");
    let encoding = "utf8";
    let processEnv = process.env;
    if (options && options.processEnv != null) {
      processEnv = options.processEnv;
    }
    let debug = parseBoolean(processEnv.DOTENV_CONFIG_DEBUG || options && options.debug);
    let quiet = parseBoolean(processEnv.DOTENV_CONFIG_QUIET || options && options.quiet);
    if (options && options.encoding) {
      encoding = options.encoding;
    } else {
      if (debug) {
        _debug("No encoding is specified. UTF-8 is used by default");
      }
    }
    let optionPaths = [dotenvPath];
    if (options && options.path) {
      if (!Array.isArray(options.path)) {
        optionPaths = [_resolveHome(options.path)];
      } else {
        optionPaths = [];
        for (const filepath of options.path) {
          optionPaths.push(_resolveHome(filepath));
        }
      }
    }
    let lastError;
    const parsedAll = {};
    for (const path2 of optionPaths) {
      try {
        const parsed = DotenvModule.parse(fs.readFileSync(path2, { encoding }));
        DotenvModule.populate(parsedAll, parsed, options);
      } catch (e) {
        if (debug) {
          _debug(`Failed to load ${path2} ${e.message}`);
        }
        lastError = e;
      }
    }
    const populated = DotenvModule.populate(processEnv, parsedAll, options);
    debug = parseBoolean(processEnv.DOTENV_CONFIG_DEBUG || debug);
    quiet = parseBoolean(processEnv.DOTENV_CONFIG_QUIET || quiet);
    if (debug || !quiet) {
      const keysCount = Object.keys(populated).length;
      const shortPaths = [];
      for (const filePath of optionPaths) {
        try {
          const relative = path.relative(process.cwd(), filePath);
          shortPaths.push(relative);
        } catch (e) {
          if (debug) {
            _debug(`Failed to load ${filePath} ${e.message}`);
          }
          lastError = e;
        }
      }
      _log(`injecting env (${keysCount}) from ${shortPaths.join(",")} ${dim(`-- tip: ${_getRandomTip()}`)}`);
    }
    if (lastError) {
      return { parsed: parsedAll, error: lastError };
    } else {
      return { parsed: parsedAll };
    }
  }
  function config(options) {
    if (_dotenvKey(options).length === 0) {
      return DotenvModule.configDotenv(options);
    }
    const vaultPath = _vaultPath(options);
    if (!vaultPath) {
      _warn(`You set DOTENV_KEY but you are missing a .env.vault file at ${vaultPath}. Did you forget to build it?`);
      return DotenvModule.configDotenv(options);
    }
    return DotenvModule._configVault(options);
  }
  function decrypt(encrypted, keyStr) {
    const key = Buffer.from(keyStr.slice(-64), "hex");
    let ciphertext = Buffer.from(encrypted, "base64");
    const nonce = ciphertext.subarray(0, 12);
    const authTag = ciphertext.subarray(-16);
    ciphertext = ciphertext.subarray(12, -16);
    try {
      const aesgcm = crypto.createDecipheriv("aes-256-gcm", key, nonce);
      aesgcm.setAuthTag(authTag);
      return `${aesgcm.update(ciphertext)}${aesgcm.final()}`;
    } catch (error) {
      const isRange = error instanceof RangeError;
      const invalidKeyLength = error.message === "Invalid key length";
      const decryptionFailed = error.message === "Unsupported state or unable to authenticate data";
      if (isRange || invalidKeyLength) {
        const err = new Error("INVALID_DOTENV_KEY: It must be 64 characters long (or more)");
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      } else if (decryptionFailed) {
        const err = new Error("DECRYPTION_FAILED: Please check your DOTENV_KEY");
        err.code = "DECRYPTION_FAILED";
        throw err;
      } else {
        throw error;
      }
    }
  }
  function populate(processEnv, parsed, options = {}) {
    const debug = Boolean(options && options.debug);
    const override = Boolean(options && options.override);
    const populated = {};
    if (typeof parsed !== "object") {
      const err = new Error("OBJECT_REQUIRED: Please check the processEnv argument being passed to populate");
      err.code = "OBJECT_REQUIRED";
      throw err;
    }
    for (const key of Object.keys(parsed)) {
      if (Object.prototype.hasOwnProperty.call(processEnv, key)) {
        if (override === true) {
          processEnv[key] = parsed[key];
          populated[key] = parsed[key];
        }
        if (debug) {
          if (override === true) {
            _debug(`"${key}" is already defined and WAS overwritten`);
          } else {
            _debug(`"${key}" is already defined and was NOT overwritten`);
          }
        }
      } else {
        processEnv[key] = parsed[key];
        populated[key] = parsed[key];
      }
    }
    return populated;
  }
  var DotenvModule = {
    configDotenv,
    _configVault,
    _parseVault,
    config,
    decrypt,
    parse,
    populate
  };
  exports.configDotenv = DotenvModule.configDotenv;
  exports._configVault = DotenvModule._configVault;
  exports._parseVault = DotenvModule._parseVault;
  exports.config = DotenvModule.config;
  exports.decrypt = DotenvModule.decrypt;
  exports.parse = DotenvModule.parse;
  exports.populate = DotenvModule.populate;
  module.exports = DotenvModule;
});

// electron.ts
import { app, BrowserWindow, screen, Tray, Menu, nativeImage } from "electron";
import * as path from "path";
import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import { fileURLToPath } from "url";
require_main().config();
function getConfig() {
  try {
    const configPath = path.join(os.homedir(), ".config", "opencode", "opencode-avatar.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!config.falKey) {
      return { falKey: null, prompt: null };
    }
    return { falKey: config.falKey, prompt: config.prompt || null };
  } catch (error) {
    return { falKey: null, prompt: null };
  }
}
var FAL_CDN_URL = "https://v3.fal.media";
var FAL_REST_URL = "https://rest.alpha.fal.ai";
var FAL_NANO_BANANA_URL = "https://fal.run/fal-ai/nano-banana-pro/edit";
var __filename2 = fileURLToPath(import.meta.url);
var __dirnameResolved = path.dirname(__filename2);
var AVATAR_DIR = path.join(os.homedir(), ".config", "opencode");
var HTML_CONTENT = `<!DOCTYPE html>
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

        // Chroma keying: make background transparent
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const chromaR = data[0]; // first pixel R
        const chromaG = data[1]; // first pixel G
        const chromaB = data[2]; // first pixel B
        const tolerance = 30;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (Math.abs(r - chromaR) <= tolerance &&
              Math.abs(g - chromaG) <= tolerance &&
              Math.abs(b - chromaB) <= tolerance) {
            data[i + 3] = 0; // set alpha to 0
          }
        }

        ctx.putImageData(imageData, 0, 0);

        img.src = canvas.toDataURL('image/png');
      };

        srcImg.onerror = function(e) {
          console.error('Failed to load image:', e);
          img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
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
var mainWindow = null;
var tray = null;
var httpServer = null;
var ongoingGenerations = new Map;
var lastHeartbeat = Date.now();
var HEARTBEAT_TIMEOUT = 1000;
function promptToFilename(prompt) {
  return "avatar_" + prompt.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, "_").substring(0, 50) + ".png";
}
function getAvatarPort() {
  const args = process.argv;
  const portIndex = args.indexOf("--avatar-port");
  if (portIndex !== -1 && args[portIndex + 1]) {
    return parseInt(args[portIndex + 1], 10);
  }
  return 47291;
}
function getAvatarPath() {
  const args = process.argv;
  const avatarIndex = args.indexOf("--avatar");
  if (avatarIndex !== -1 && args[avatarIndex + 1]) {
    const avatarArg = args[avatarIndex + 1];
    if (!path.isAbsolute(avatarArg)) {
      return path.join(AVATAR_DIR, avatarArg);
    }
    return avatarArg;
  }
  return path.join(AVATAR_DIR, "avatar.png");
}
async function uploadFile(filePath, falKey) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const tokenResponse = await fetch(`${FAL_REST_URL}/storage/auth/token?storage_type=fal-cdn-v3`, {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    throw new Error(`Failed to get upload token: ${tokenResponse.status} ${tokenResponse.statusText} - ${text}`);
  }
  const tokenData = await tokenResponse.json();
  const uploadUrl = `${tokenData.base_upload_url || FAL_CDN_URL}/files/upload`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenData.token}`,
      "Content-Type": "image/png",
      "X-Fal-File-Name": fileName
    },
    body: fileBuffer
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to upload file: ${response.status} ${response.statusText} - ${text}`);
  }
  const result = await response.json();
  return result.access_url || result.url || "";
}
async function generateAvatarImage(imageUrl, prompt, falKey) {
  const response = await fetch(FAL_NANO_BANANA_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt,
      image_urls: [imageUrl]
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to generate avatar: ${response.status} ${response.statusText} - ${text}`);
  }
  return response.json();
}
async function downloadImage(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}
async function generateAvatarForPrompt(prompt) {
  const config = getConfig();
  if (!config.falKey) {
    console.warn("falKey is not set. Cannot generate avatar. Using default avatar.");
    return path.join(AVATAR_DIR, "avatar.png");
  }
  const cachedFilename = promptToFilename(prompt);
  const cachedPath = path.join(AVATAR_DIR, cachedFilename);
  if (fs.existsSync(cachedPath)) {
    return cachedPath;
  }
  if (ongoingGenerations.has(cachedFilename)) {
    await ongoingGenerations.get(cachedFilename);
    return cachedPath;
  }
  const generationPromise = (async () => {
    try {
      if (fs.existsSync(cachedPath)) {
        return;
      }
      const sourceAvatar = path.join(AVATAR_DIR, "avatar.png");
      const uploadedUrl = await uploadFile(sourceAvatar, config.falKey);
      let fullPrompt = `make a character variant: ${prompt}. Keep the background as a solid green screen color. Do not let the green screen color appear in reflections or on the subject.`;
      if (config.prompt) {
        fullPrompt += ` ${config.prompt}`;
      }
      const result = await generateAvatarImage(uploadedUrl, fullPrompt, config.falKey);
      const outputUrl = result.images?.[0]?.url || result.image?.url || result.url;
      if (!outputUrl) {
        throw new Error("No output image URL in response: " + JSON.stringify(result, null, 2));
      }
      await downloadImage(outputUrl, cachedPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Error generating avatar:", message);
      throw error;
    } finally {
      ongoingGenerations.delete(cachedFilename);
    }
  })();
  ongoingGenerations.set(cachedFilename, generationPromise);
  await generationPromise;
  return cachedPath;
}
function startHeartbeatChecker() {
  setInterval(() => {
    const timeSinceLastHeartbeat = Date.now() - lastHeartbeat;
    if (timeSinceLastHeartbeat > HEARTBEAT_TIMEOUT) {
      app.isQuitting = true;
      app.quit();
    }
  }, 1000);
}
function startAvatarServer() {
  const port = getAvatarPort();
  httpServer = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/set-avatar") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          const { avatarPath } = JSON.parse(body);
          if (mainWindow && avatarPath) {
            const imageBuffer = fs.readFileSync(avatarPath);
            const base64 = imageBuffer.toString("base64");
            const dataUrl = `data:image/png;base64,${base64}`;
            mainWindow.webContents.send("set-avatar", dataUrl);
            updateTrayIcon(avatarPath);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {}
      });
    } else if (req.method === "POST" && req.url === "/generate-avatar") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const { prompt } = JSON.parse(body);
          if (!prompt) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing prompt" }));
            return;
          }
          const avatarPath = await generateAvatarForPrompt(prompt);
          if (mainWindow) {
            const imageBuffer = fs.readFileSync(avatarPath);
            const base64 = imageBuffer.toString("base64");
            const dataUrl = `data:image/png;base64,${base64}`;
            mainWindow.webContents.send("set-avatar", dataUrl);
            updateTrayIcon(avatarPath);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, avatarPath }));
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error("Error in generate-avatar:", e);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message }));
        }
      });
    } else if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else if (req.method === "POST" && req.url === "/heartbeat") {
      lastHeartbeat = Date.now();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else if (req.method === "POST" && req.url === "/shutdown") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "shutting down" }));
      setTimeout(() => {
        app.isQuitting = true;
        app.quit();
      }, 100);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  httpServer.listen(port, "127.0.0.1", () => {});
  httpServer.on("error", (err) => {});
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
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML_CONTENT)}`);
  mainWindow.webContents.on("did-finish-load", () => {
    if (mainWindow) {
      const avatarPath = getAvatarPath();
      try {
        const imageBuffer = fs.readFileSync(avatarPath);
        const base64 = imageBuffer.toString("base64");
        const dataUrl = `data:image/png;base64,${base64}`;
        mainWindow.webContents.send("set-avatar", dataUrl);
        updateTrayIcon(avatarPath);
        setTimeout(() => {
          if (mainWindow && !mainWindow.isVisible()) {
            mainWindow.show();
            mainWindow.setAlwaysOnTop(true, "screen-saver");
          }
        }, 100);
      } catch (error) {}
    }
  });
  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {});
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}
function createTray() {
  let trayIcon;
  try {
    const pngPath = path.join(AVATAR_DIR, "avatar.png");
    trayIcon = processTrayIcon(pngPath);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    trayIcon = nativeImage.createFromPath(path.join(AVATAR_DIR, "avatar.svg"));
  }
  tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show/Hide",
      click: () => mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show()
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setToolTip("Desktop Clippy");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show());
}
function processTrayIcon(pngPath) {
  let trayIcon = nativeImage.createFromPath(pngPath);
  if (!trayIcon.isEmpty()) {
    const size = trayIcon.getSize();
    const bitmap = trayIcon.getBitmap();
    const chromaR = bitmap[0];
    const chromaG = bitmap[1];
    const chromaB = bitmap[2];
    const tolerance = 30;
    for (let i = 0;i < bitmap.length; i += 4) {
      const r = bitmap[i];
      const g = bitmap[i + 1];
      const b = bitmap[i + 2];
      if (Math.abs(r - chromaR) <= tolerance && Math.abs(g - chromaG) <= tolerance && Math.abs(b - chromaB) <= tolerance) {
        bitmap[i + 3] = 0;
      }
    }
    trayIcon = nativeImage.createFromBitmap(bitmap, size);
  } else {
    trayIcon = nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");
  }
  return trayIcon;
}
function updateTrayIcon(avatarPath) {
  if (tray) {
    const trayIcon = processTrayIcon(avatarPath);
    tray.setImage(trayIcon);
  }
}
app.commandLine.appendSwitch("enable-transparent-visuals");
app.whenReady().then(async () => {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  const avatarPath = path.join(AVATAR_DIR, "avatar.png");
  if (!fs.existsSync(avatarPath)) {
    try {
      await downloadImage("https://richardanaya.github.io/opencode-avatar/avatar.png", avatarPath);
      console.log("Downloaded default avatar to", avatarPath);
    } catch (error) {
      console.warn("Failed to download default avatar:", error);
    }
  }
  setTimeout(() => {
    createWindow();
    createTray();
    startAvatarServer();
    startHeartbeatChecker();
  }, 300);
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin")
    app.quit();
});

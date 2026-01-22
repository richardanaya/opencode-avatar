# OpenCode Avatar Plugin

A dynamic desktop avatar plugin for OpenCode that displays animated character reactions based on your coding activities.

<div align="center"><img src="https://github.com/user-attachments/assets/504043c9-954d-4cfd-93ff-0904d2d4eb95" alt="Avatar" width="300" /></div>

## Features

- **Dynamic Avatar Display**: Desktop character that reacts to your OpenCode usage
- **Thinking Animation**: Shows "thinking hard" when you send messages
- **Tool-Based Reactions**: Avatar changes pose based on which tools are being used
- **Smart Caching**: Generated avatars are cached for instant loading
- **Non-Intrusive**: Appears without stealing focus, stays on top
- **Auto-Shutdown**: Automatically closes when OpenCode exits
- **Toast Notifications**: Shows progress for avatar generation
- **Customizable Prompts**: Optional prompt configuration for personalized avatar styles

## Installation

Then add to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-avatar"]
}
```

## Configuration

### API Key Configuration

Create a config file at `~/.config/opencode/opencode-avatar.json`:

```json
{
  "falKey": "your_fal_ai_api_key_here"
}
```

Get your FAL.ai API key from [fal.ai](https://fal.ai).

### Custom Prompt Configuration (Optional)

You can optionally add a `"prompt"` field to customize how avatars are generated. This text will be appended to all avatar generation prompts:

```json
{
  "falKey": "your_fal_ai_api_key_here",
  "prompt": "in a futuristic cyberpunk style with neon lights"
}
```

The prompt will be added to the end of the AI generation request, allowing you to customize the avatar style, theme, or appearance consistently across all avatar variants.

### Avatar Images

The plugin automatically downloads a default avatar (`avatar.png`) to `~/.config/opencode/avatar.png` if it doesn't exist. This serves as the source image for generating animated variants.

#### Using a Custom Avatar

To use your own custom avatar:

1. Place your custom `avatar.png` image in `~/.config/opencode/`
2. The plugin will use this as the base image for all avatar variants
3. Ensure your image has a solid green background (RGB: 0, 255, 0) for best results with the chroma key processing

#### Generated Variants

The plugin generates and caches avatar variants in the same directory:

- `avatar_write.png` - Writing pose
- `avatar_read.png` - Reading pose
- `avatar_thinking_hard.png` - Thinking animation
- And more based on tool usage

All avatars are stored in `~/.config/opencode/` for persistence across updates.

## How It Works

### Avatar States

| State | Trigger | Description |
|-------|---------|-------------|
| **Default** | Session idle | Neutral pose, waiting for input |
| **Thinking** | User message | "Thinking hard" animation while processing |
| **Tool Active** | Tool execution | Pose based on current tool (write, read, etc.) |

### Tool Mappings

The avatar automatically detects which tools you're using and shows appropriate reactions:

| Tool | Avatar Pose |
|------|-------------|
| `write` | Writing with pencil |
| `read` | Reading a book |
| `edit` | Editing with scissors |
| `glob` | Searching with magnifying glass |
| `grep` | Detective searching |
| `bash` | Hacker typing |
| `webfetch` | Surfing the web |

### File Naming

Avatar images are cached with predictable filenames:
- `avatar_write.png` - Writing tool
- `avatar_read.png` - Reading tool
- `avatar_thinking_hard.png` - Thinking state

## Usage

### Basic Usage

1. Install the plugin
2. Configure your FAL.ai API key
3. Start OpenCode - avatar appears automatically
4. Send messages - avatar shows thinking animation
5. Use tools - avatar reacts to each tool

### Manual Control

The avatar responds automatically, but you can also:

- **Show/Hide**: Click the system tray icon
- **Quit**: Right-click tray icon → Quit
- **Move**: Drag the avatar window to reposition

### Logs and Debugging

Check the console output for detailed information.

The output shows:
- Plugin initialization
- Avatar generation requests
- Tool execution detection
- Electron process lifecycle

## Architecture

### Components

```
├── index.ts          # Main plugin logic
├── electron.ts       # Desktop window management
├── avatar.png        # Default avatar image
└── dist/            # Compiled output
```

### Communication Flow

1. **Plugin** detects OpenCode events (messages, tool usage)
2. **HTTP** requests sent to Electron process
3. **Electron** generates/updates avatar via FAL.ai API
4. **Window** displays new avatar image
5. **Heartbeat** ensures Electron stays alive

### Safety Features

- **Duplicate Prevention**: Only one avatar instance runs
- **Multi-Instance Support**: Multiple OpenCode instances share the same avatar window
- **Auto-Shutdown**: Closes when OpenCode exits
- **Focus Protection**: Never steals keyboard focus
- **Error Handling**: Graceful fallbacks on failures

## API Reference

### Plugin Hooks

- `chat.message` - Detects user input
- `tool.execute.before` - Detects tool usage
- `event` - Handles session state changes

### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/heartbeat` | POST | Keep-alive signal |
| `/set-avatar` | POST | Change displayed avatar |
| `/generate-avatar` | POST | Generate new avatar |
| `/shutdown` | POST | Graceful shutdown |

## Troubleshooting

### Avatar Not Showing

1. Check console output for errors
2. Verify FAL.ai API key in `~/.config/opencode/opencode-avatar.json`
3. Ensure port 47291 is available
4. Try restarting OpenCode

### Avatar Generation Failing

1. Check FAL.ai API key validity
2. Verify internet connection
3. Check available disk space for cache
4. Look for API rate limits

### Focus Issues

- Avatar should never steal focus
- If it does, check Electron window settings
- Try `focusable: false` in window config

### Performance Issues

- First avatar generation takes ~10-30 seconds
- Subsequent loads are instant (cached)
- Reduce avatar size for faster generation

## Development

### Building

```bash
npm run build
```

### Testing

```bash
# Test Electron window
npm run start

# Test with thinking avatar
npm run start:thinking
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Credits

- **FAL.ai** - AI image generation
- **Electron** - Desktop application framework
- **OpenCode** - Plugin ecosystem

## Changelog

### v0.1.0
- Initial release
- Basic avatar display
- Thinking animation
- Tool-based reactions
- Caching system
- Auto-shutdown
- Focus protection

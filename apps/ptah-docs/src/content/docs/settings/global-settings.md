---
title: Global Settings
description: The full schema of ~/.ptah/settings.json.
---

import { Aside } from '@astrojs/starlight/components';

Global settings live in a single JSON file at `~/.ptah/settings.json`. This file is created automatically on first launch and is safe to edit by hand — Ptah watches it for changes.

## File location

| OS      | Path                                 |
| ------- | ------------------------------------ |
| Windows | `C:\Users\<you>\.ptah\settings.json` |
| macOS   | `/Users/<you>/.ptah/settings.json`   |
| Linux   | `/home/<you>/.ptah/settings.json`    |

## Schema

```jsonc
{
  // Appearance
  "theme": "dark", // "light" | "dark" | "system"

  // Default routing
  "defaultProvider": "claude", // Used when a chat doesn't specify one
  "defaultModel": "claude-sonnet-4-7",
  "defaultEffort": "balanced", // "fast" | "balanced" | "deep"

  // Provider credentials (encrypted at rest; see note below)
  "providers": {
    "claude": { "apiKey": "sk-ant-..." },
    "copilot": { "apiKey": "..." },
    "codex": { "apiKey": "..." },
    "gemini": { "apiKey": "..." },
    "ollama": { "baseUrl": "http://localhost:11434" },
    "openrouter": { "apiKey": "sk-or-..." },
  },

  // Web search providers
  "webSearch": {
    "tavily": { "apiKey": "tvly-..." },
    "serper": { "apiKey": "..." },
    "exa": { "apiKey": "..." },
  },

  // Built-in MCP server
  "mcp": {
    "port": 51820, // 0 to let the OS pick a free port
    "host": "127.0.0.1",
  },

  // Browser automation (Pro)
  "browser": {
    "executablePath": null, // null = bundled Chromium
    "headless": false,
    "viewport": { "width": 1280, "height": 800 },
    "persistProfile": false,
  },

  // Autopilot
  "autopilot": {
    "enabled": false,
    "autoApproveReads": true,
    "autoApproveWrites": false,
    "autoApproveShell": false,
  },
}
```

## Key reference

### Appearance

| Key     | Type | Description                  |
| ------- | ---- | ---------------------------- |
| `theme` | enum | `light`, `dark`, or `system` |

### Default routing

| Key               | Type   | Description                                                               |
| ----------------- | ------ | ------------------------------------------------------------------------- |
| `defaultProvider` | string | Provider used when a new chat is opened                                   |
| `defaultModel`    | string | Model id within that provider                                             |
| `defaultEffort`   | enum   | `fast`, `balanced`, or `deep` — controls reasoning budget where supported |

### Providers

Each provider is an object under `providers`. Keys vary by provider — see the **API keys** page for the exact fields each one supports.

### Web search

The `webSearch` block stores keys for Tavily, Serper, and Exa. If more than one is configured, the agent picks the first available in that order.

### MCP

The built-in MCP server listens on `mcp.port` (default `51820`) bound to `mcp.host`. Set `port` to `0` to let the OS pick a free port on startup — useful when the default is already in use.

### Browser

Controls the Pro-tier browser automation suite. See **Browser Automation → Launching a Browser** for details.

### Autopilot

Gates autonomous execution. See the dedicated **Autopilot** page for the full rundown.

## Encryption of secrets

<Aside type="tip">
Fields named `apiKey` are encrypted on disk using Electron's `safeStorage` API, which delegates to the OS keychain:

- **Windows** — DPAPI (per-user)
- **macOS** — Keychain
- **Linux** — libsecret / gnome-keyring

Ciphertext is what lands in `settings.json`; the plaintext key never touches disk.

</Aside>

If `safeStorage` is unavailable (e.g. on a headless Linux system with no keyring), Ptah refuses to save API keys and prompts you to enter them per-session instead.

## Hot reload

Ptah watches `settings.json` and reloads most keys without restarting. Changes to `mcp.port` and `browser.executablePath` take effect on the next launch.

# Live Electron check - TASK_2026_862_bf84

Date: 2026-11-03 (build-dev of the worktree, locked through scripts/verify.mjs).

## Setup

- Windows 11 x64. Installed codex: `codex-cli 0.166.0` (npm global shim at
  `%APPDATA%\npm\codex`). Bundled codex: 0.165.0 (`@openai/codex-sdk` 0.165.0).
- Launch: `apps/ptah-electron/scripts/launch.js --remote-debugging-port=9237 <temp workspace>`,
  NODE_ENV=development, temp PTAH_DB_PATH / PTAH_SESSIONS_DB_PATH, driven over CDP (Playwright).
- Main agent set to OpenAI Codex / gpt-6-luna at the "This workspace" layer of a temporary
  workspace. The two entries this wrote to `~/.ptah/settings.json` were removed after the check;
  the file was compared with a pre-check copy and is identical.

## Results

| Check | Result |
| ----- | ------ |
| Binary selection | Log: `Codex executable selected: {"source":"installed","version":"0.166.0","reason":"Using installed Codex 0.166.0."}` |
| npm shim to native exe | Detection path `...\npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe` |
| Status line (CLI matrix) | `Codex | Installed Codex 0.166.0 | Ready | OpenAI Codex | gpt-6-sol | high` |
| Dynamic model list | Main agent model picker lists `GPT-6-Luna`, `GPT-5.6-Luna` from model/list |
| Chat turn, gpt-6-luna | Prompt "Reply with exactly one word: pong" → reply `pong` |
| Usage | Rail: Ctx 7.6 %, Tok 19.7k, Cost `$0.0008 covered by subscription` |
| Auth | ~/.codex OAuth login used with the installed binary (no re-login) |
| Paid turns | 1 (subscription-covered), authorized by the user |

## Observations

- The selection INFO line is logged on every open/detection (9 times in a short run). Reduce
  repeated identical selections to debug level.
- Not exercised live: bundled fallback (installed below minimum) and lanes; covered by unit
  specs.

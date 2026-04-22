---
title: CLI Agent Not Detected
description: Making Copilot, Gemini, and Codex CLIs visible to Ptah.
---

import { Aside } from '@astrojs/starlight/components';

Ptah can drive several external CLI agents as providers. Each one has to be installed and on the `PATH` before Ptah will offer it in the provider picker.

## Quick check

**Settings → Providers** shows a detection status next to each CLI provider. A green "Detected" badge means Ptah found the binary. A red "Not found" badge means it did not.

## Installing the CLIs

| Provider | Install command                              | Binary name |
| -------- | -------------------------------------------- | ----------- |
| Copilot  | Follow the official Copilot CLI instructions | `copilot`   |
| Gemini   | `npm install -g @google/gemini-cli`          | `gemini`    |
| Codex    | Follow the official Codex CLI instructions   | `codex`     |

After installing, **fully quit and restart Ptah** so it picks up the new `PATH`.

## Common problems

**Symptom:** CLI works in a terminal but Ptah says "Not found."
**Likely cause:** Ptah inherited the `PATH` from your desktop session, not from your shell's rc file.
**Fix:** On macOS/Linux, add the install location to your login environment (e.g. `~/.zprofile` or `~/.profile`). On Windows, add it to **System Properties → Environment Variables → Path**. Then relaunch Ptah.

---

**Symptom:** `ENOENT: spawn copilot` on Windows, even though `copilot --version` works in a terminal.
**Likely cause:** npm-installed CLIs on Windows are `.cmd` wrapper scripts. Node's `spawn()` with `shell: false` cannot execute `.cmd` files directly.
**Fix:** Ptah handles this automatically via a shell-execution fallback, but if you've customised the CLI install:

- Make sure the `.cmd` wrapper is the one on `PATH` (not a stray `.ps1`).
- Verify by running `where copilot` in PowerShell — the first match should end in `.cmd`.

<Aside type="tip">
If you install Node via a version manager (nvm-windows, fnm), reinstall global CLIs after switching Node versions. Global packages are not shared between Node versions.
</Aside>

---

**Symptom:** CLI detected but the first message fails with "authentication required."
**Likely cause:** The CLI has not completed its own login flow yet.
**Fix:** Open a terminal and run the CLI's login command once (for example `gemini auth login`). Return to Ptah; the next request will use the stored credentials.

---

**Symptom:** CLI detected but runs with the wrong account.
**Likely cause:** The CLI uses a token file that another tool overwrote.
**Fix:** Re-run the CLI's login command. Each CLI stores its credentials independently of Ptah.

## Forcing a specific binary

You can override auto-detection by setting an absolute path in `~/.ptah/settings.json`:

```json
{
  "providers": {
    "gemini": { "executablePath": "/opt/homebrew/bin/gemini" }
  }
}
```

This skips `PATH` lookup entirely and is useful when multiple versions are installed side-by-side.

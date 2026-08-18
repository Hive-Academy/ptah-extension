---
title: MCP Port Conflicts
description: Resolving conflicts on the built-in MCP server port.
---

import { Aside } from '@astrojs/starlight/components';

Ptah's built-in MCP server listens on **TCP 51820** by default, bound to `127.0.0.1`. If another process already owns that port, Ptah falls back to an OS-assigned port and logs the actual port at startup.

## Symptoms

**Symptom:** Startup toast "MCP port 51820 in use; listening on 57204 instead."
**Likely cause:** Another process holds the default port (often a second Ptah instance or a VPN client).
**Fix:** No action needed — the fallback port works. If you need a stable port (for scripts or external clients), pick a new default in **Settings → MCP → Port**.

---

**Symptom:** External MCP clients can't connect at all.
**Likely cause:** Client is hard-coded to `51820`, but Ptah fell back to a different port.
**Fix:** Set `mcp.port` to a free, stable port in `~/.ptah/settings.json`:

```json
{
  "mcp": { "port": 52000 }
}
```

Restart Ptah. External clients can now use the fixed port.

---

**Symptom:** Even with a custom port, startup logs show the OS picked another port.
**Likely cause:** Your custom port is also in use.
**Fix:** Find a free port with `netstat` / `lsof` and retry:

```bash
# Windows
netstat -ano | findstr :52000

# macOS / Linux
lsof -iTCP:52000 -sTCP:LISTEN
```

## Finding the active port

The current MCP port appears in two places:

- **Settings → MCP → Status** shows the live port.
- The startup log (see **Logs & diagnostics**) contains `MCP server listening on 127.0.0.1:<port>`.

## Zero-conf mode

Set `mcp.port` to `0` to let the OS pick a free port on every launch. This is convenient but means external clients have to discover the port at runtime.

<Aside type="tip">
If you run multiple Ptah profiles on the same machine, set each one to a different fixed port to avoid startup collisions.
</Aside>

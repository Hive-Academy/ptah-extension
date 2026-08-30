---
title: CLI Flags
description: Command-line arguments accepted by the Ptah desktop app and the Ptah CLI.
---

This page covers two separate programs. The **desktop app** is the Electron
executable you install. The **Ptah CLI** is the `@hive-academy/ptah-cli` npm
package, which provides the `ptah` command in a terminal.

## Desktop app

The desktop app accepts one positional argument.

```bash
Ptah [workspace-path]
```

If `workspace-path` points to a directory, Ptah opens it as the active workspace on startup. Relative paths resolve against the current working directory.

The desktop app accepts no other flags. It reads one environment variable.

| Variable         | Values                                    | Purpose                        |
| ---------------- | ----------------------------------------- | ------------------------------ |
| `PTAH_LOG_LEVEL` | `error`, `warn`, `info`, `debug`, `trace` | Set the log level for one run. |

Set `PTAH_LOG_LEVEL=debug` before you file a bug. See [Logs & Diagnostics](/troubleshooting/logs-and-diagnostics/) for where the log file lands.

## Ptah CLI

The `ptah` command is a separate npm package. Run `ptah --help` for the full
command list, and `ptah <command> --help` for one command. The command groups
include `init`, `config`, `harness`, `chat`, `doctor`, `packs`, `agent-cli`,
`interact`, `mcp-serve`, and `tui`.

### `ptah interact` — embedded Anthropic-compatible proxy

`ptah interact` can boot an embedded HTTP proxy that exposes an Anthropic-compatible API surface, optionally re-exporting Ptah's workspace MCP tools. Use it for external clients or supervisors that already speak the Anthropic protocol.

| Flag                             | Argument | Purpose                                           |
| -------------------------------- | -------- | ------------------------------------------------- |
| `--proxy-start`                  | —        | Boot the embedded Anthropic-compatible HTTP proxy |
| `--proxy-port`                   | `<n>`    | TCP port (`0` = OS-assigned)                      |
| `--proxy-host`                   | `<host>` | Bind host (default `127.0.0.1`)                   |
| `--proxy-expose-workspace-tools` | —        | Surface workspace MCP tools through the proxy     |

The bound address is printed on stderr as:

```text
[ptah] proxy listening on http://127.0.0.1:54321
```

Supervisors can scrape that line to discover the live address when `--proxy-port=0` is used.

## Examples

Open a specific workspace with debug logging:

```bash
# Windows PowerShell
$env:PTAH_LOG_LEVEL = 'debug'
& "C:\Users\<you>\AppData\Local\Programs\Ptah\Ptah.exe" "D:\projects\my-app"

# macOS
PTAH_LOG_LEVEL=debug /Applications/Ptah.app/Contents/MacOS/Ptah ~/code/my-app

# Linux
PTAH_LOG_LEVEL=debug ./Ptah-*.AppImage ~/code/my-app
```

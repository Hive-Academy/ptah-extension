---
title: CLI Flags
description: Command-line arguments accepted by the Ptah desktop app.
---

The Ptah executable accepts a small set of command-line arguments for automation and troubleshooting.

## Positional argument

```bash
ptah [workspace-path]
```

If `workspace-path` is provided and points to a directory, Ptah opens it as the active workspace on startup. Relative paths are resolved against the current working directory.

## Flags

| Flag              | Argument  | Purpose                                                                                              |
| ----------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `--dev`           | —         | Enable development mode: verbose logging, DevTools auto-open                                         |
| `--profile`       | `<name>`  | Use an isolated user-data directory named `<name>`; lets you run multiple independent Ptah instances |
| `--user-data-dir` | `<path>`  | Override the user-data directory with an absolute path                                               |
| `--log-level`     | `<level>` | One of `error`, `warn`, `info`, `debug`, `trace`                                                     |
| `--no-gpu`        | —         | Disable hardware acceleration; useful for flaky GPU drivers                                          |
| `--headless`      | —         | Start with no visible window; intended for CI / smoke tests                                          |
| `--version`       | —         | Print the version and exit                                                                           |
| `--help`          | —         | Print usage and exit                                                                                 |

## Environment variables

The same behavior is also available through environment variables, which is often more convenient when launching from a shell script:

| Variable             | Equivalent to     |
| -------------------- | ----------------- |
| `PTAH_LOG`           | `--log-level`     |
| `PTAH_PROFILE`       | `--profile`       |
| `PTAH_USER_DATA_DIR` | `--user-data-dir` |

## Examples

Open a specific workspace with debug logging:

```bash
# Windows
"C:\Users\<you>\AppData\Local\Programs\Ptah\Ptah.exe" "D:\projects\my-app" --log-level=debug

# macOS
/Applications/Ptah.app/Contents/MacOS/Ptah ~/code/my-app --log-level=debug

# Linux
./Ptah-*.AppImage ~/code/my-app --log-level=debug
```

Run two independent Ptah instances:

```bash
Ptah --profile=work
Ptah --profile=personal
```

Each profile keeps its own settings, plugins, agents, and logs.

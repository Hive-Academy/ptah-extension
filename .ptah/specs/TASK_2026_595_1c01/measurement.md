# Tools/list measurement - TASK_2026_595_1c01

Date: 2026-10-03. HEAD: `95cb1de7817b474edc844607b2a6a2303bbfcb3a` (read from worktree HEAD/ref; no git commands).

Measured `JSON.stringify(result.tools).length` from real `handleMCPRequest` calls. Approximate tokens = `Math.ceil(chars / 4)`; these are estimates, not tokenizer counts.

| Host | Stage | Tools | Characters | Approx. tokens |
| --- | --- | ---: | ---: | ---: |
| Electron-like | Before (both profiles) | 53 | 123484 | 30871 |
| Electron-like | After coding | 50 | 54471 | 13618 |
| Electron-like | After apps | 53 | 123568 | 30892 |
| VS Code-like | Before (both profiles) | 56 | 125789 | 31448 |
| VS Code-like | After coding | 53 | 56776 | 14194 |
| VS Code-like | After apps | 56 | 125873 | 31469 |

Electron-like: coding saves 69013 characters and 17253 estimated tokens versus baseline; apps minus coding = 69097 characters.

VS Code-like: coding saves 69013 characters and 17254 estimated tokens versus baseline; apps minus coding = 69097 characters.

Per-tool serialized sizes in the final Apps listing (including eager/result-budget metadata):

| Tool | Characters |
| --- | ---: |
| ptah_dashboard_propose_spec | 1613 |
| ptah_surface_update | 65264 |
| ptah_surface_get_state | 2217 |

The three Apps-only tools are absent in coding and eager in apps (`_meta["anthropic/alwaysLoad"] = true`). The Apps listing grows by the eager metadata; coding retains the other tool definitions and order.

Host settings: Electron-like hasIDECapabilities=false / hasSqliteLayer=true; VS Code-like hasIDECapabilities=true / hasSqliteLayer=false.

Baseline was captured before production edits (1 suite / 2 tests passed). The plan's --testPathPattern option is now --testPathPatterns under Nx 23/Jest 30. This worktree has no local node_modules, so the root Jest preset's absolute marked path fails. Measurements ran via Jest runCLI with the existing project configuration and only ^marked$ mapped to the installed parent repository package. No dependency/configuration files were changed.

No exact-token or live-app cross-check was performed. The temporary measurement spec is removed after the measurements; permanent profile listing and dispatch specs provide the regression guard.

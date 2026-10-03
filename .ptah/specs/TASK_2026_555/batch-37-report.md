# Batch 37 report: close-out (executor: in-process, track A worktree, head `68dc462cb`, nothing committed)

Logs are in `%TEMP%\b37-*.log`. Free space on D: 46.7 GB before every build.

## Task 37.1: live scripts

| Item | Change / evidence |
|---|---|
| `provider-settings.e2e.spec.ts` | Verified gone: no file of that name under `libs/frontend/webview-e2e-harness` |
| `apps/ptah-electron-e2e/src/docs-screenshots/workspace-settings.shot.ts` | Landing assertion now `#providers-connections-heading`; after the Agent Orchestration shot it clicks `background-roles-summary`, then asserts `assignments-heading` |
| `apps/ptah-electron-e2e/src/specs/settings/settings.spec.ts` (`settings renders`) | Asserts the connections heading on Providers, then opens Agent Orchestration (scoped to `ptah-settings`, exact name: the unscoped name matched 3 buttons), opens the roles details, asserts `assignments-heading` |
| `src/showcase/settings-tour.scene.ts` (web-search step) | The old `[data-testid="settings-toggle-web-search-provider"]` no longer exists (Batch 45 made it per provider). Now `[data-testid^="settings-toggle-web-search-provider-"]`.first() with `waitFor({state:'visible', timeout:15 s})`: runs or throws |
| `apps/ptah-docs/SCREENSHOTS.md` :119, :189 | Rows rewritten for the Advanced tab, MCP & Browser section (port, namespaces, Allow localhost); both tables re-padded |
| Live run: docs shot | `npx nx run-many -t build-dev copy-renderer-dev -p ptah-electron`, then `npx playwright test --config=docs-screenshots.config.ts workspace-settings.shot.ts`: **3 passed** against real Electron (throwaway profile copy). It wrote 6 PNGs in `apps/ptah-docs/public/screenshots/`; copied to `%TEMP%\b37-docs-shots` and restored by exact path |
| Live run: Electron e2e settings spec | `playwright.config.ts src/specs/settings/settings.spec.ts`: **3 passed** (first run failed on the strict-mode locator above, fixed) |
| Live run: settings tour | `PTAH_SHOWCASE_USER_DATA_DIR=<temp copy of %APPDATA%\Ptah Showcase>` (a Ptah instance is running, so the default profile's single-instance lock was avoided), `playwright test --config=apps/ptah-electron-e2e/showcase.config.ts settings-tour.scene.ts`: **1 passed (2.3 m)**. The first attempt (copy of `Ptah Showcase Pristine`) failed in the director fixture (`page.evaluate: Execution context was destroyed`, `director.ts:200`) before any scene step; not reproduced. The tour ran with a copy of the user's showcase profile, not live authenticated data of the default profile, and without generated narration durations (the director falls back to estimated holds) |

## Task 37.3: harness follow-ups

| Item | Change |
|---|---|
| Opt-in error envelope | Already present as `rpcError(message)` / `__ptahRpcError` in `marketplace.fixtures.ts:102-112`, `installRpcAutoResponder` `:216-233` (Batch 49, default off; resolvers that throw are still left unanswered). No change to `marketplace.fixtures.ts` was needed. Marketplace, thoth and boot scenes use it unchanged |
| #39 reach (read-error branch) | `settings-cli-matrix.entries.ts`: after the existing picker check, a variant page where `provider:listModels` answers `rpcError` until Retry: asserts `provider-model-picker-error` shows `Could not load provider models. Retry.` (and not the host text), Retry clears it |
| #79 reach (read-error branch) | `settings-reachability.table.ts`: a variant page where `ptahCli:list` answers `rpcError` until Retry: asserts `[data-read-error="cli"]` shows `CLI agents could not be loaded. Your saved settings have not changed.`, Retry clears every `[data-read-error]` and `[data-read-loading]` |
| `EXPECTED_CAPABILITY_COUNT` | Stays **141**: the branches extend the existing #39 and #79 entries, no id added |
| NW-1 | `withWizardClosed(page, body)` in `settings-reachability.table.ts`: a failed body is the error reported; `closeWizard`'s assertion only reports when the body passed. Replaces the three `try/finally { closeWizard }` sites. (Written without `throw` in `finally`: `no-unsafe-finally` rejected the first version) |
| NW-2 | #56 in `settings-cli-matrix.entries.ts`: UI restore first, `FixtureState` (`agent.enabled = true`) restored whatever happens, restore failure never replaces the body's failure |
| NW-3 | `settings-reachability.e2e.spec.ts`: `activeTab(page)` read before each entry; the remount detour in the `finally` returns to that tab |
| Thoth scene | `thoth/skills-lane-pickers.e2e.spec.ts` was red after Batch 35 (synthesis popover backdrop intercepts the judge click); the synthesis popover is now closed first. 30 of 30 with `--repeat-each=3` |

Gate G: 9 passed (`b37-gateG.log`). Full settings folder: 88 passed, 2 skipped, 0 failed (`b37-folder.log`). The folder run rewrote 121 `current-*` captures (no `baseline-*`); backed up to `%TEMP%\b37-captures`, all restored by exact path, `git status` on the screenshots folder is clean.

## Task 37.4: spec type-check gap

Counts (`tsc --noEmit -p libs/frontend/<lib>/tsconfig.spec.json`): chat 262 -> 215, core 104 -> 97, ui 7 -> 2. No error remains in a file this task touched. Files fixed:
`advanced-settings`, `system-prompt-drawer`, `vscode-lm-config` (fixture used removed capability names; its assertion now expects `Text Chat` / `Structured Output`), `drawer-write` (`commit` is a signal), `routing-map`, `agent-orchestration-config`, `elevenlabs-panel`, `local-stt-panel`, `local-tts-panel` specs in chat; `message-sender.service.spec.ts` (branded ids); `providers-commit.service.spec.ts`, `providers-connection-setup.service.spec.ts` in core; `provider-model-picker.component.spec.ts` in ui. A first edit with PowerShell `Replace('\n', ...)` broke `\n` in test strings of `message-sender.service.spec.ts`; I repaired it and checked the diff (no `COUNCIL FRAMING` lines remain changed). Follow-up proposal (devops-engineer, `typecheck-spec` target) is in `parity-evidence.md` section 5.1.

## Task 37.2: reports

- `write-path-trace.md` and `parity-evidence.md` created in this folder. Key finding, not in plan section 3: **`ConfigWatcher` (`config-watcher.ts:57-71`, started at `agent-sdk/.../di/register.ts:633`) ends every live session on any `ptah.auth.*` secret write** (Replace key, Delete key, Cursor credential, Ptah instance key), and `auth:copilotLogin` (`auth-rpc.handlers.ts:1233`) and `auth:codexLogin` (`:1586`) reset the SDK directly. Read from code (Electron secret store verified; VS Code's own event not verified; no live run).
- `TASK_2026_551/fix-report.md` (91 lines, sections 1-3 incl. the Batch 8 UI half) and `TASK_2026_553/fix-report.md` (209 lines, incl. the Batch 2 startup survey) both exist in this worktree and are complete against the plan.
- Parity: 81 numeric inventory ids each have a Gate G entry; #21 dropped (absence spec); #40/#41/#86/#87 mapped to named entries; #85 dead code. Preserve-list rows map to `ADV-*` / `SV-*` entries plus spec titles. Rows without a spec title that names them say "Gate G step only".

## Verification (wide command, split as instructed)

| Command | Result |
|---|---|
| `nx run-many -t typecheck,lint -p <20 projects> --parallel=2` | all passed except `webview-e2e-harness:lint` (2 `no-unsafe-finally` errors in my NW edits); fixed; harness, chat, core, ui and ptah-electron-e2e re-run: pass (`b37-typecheck-lint-2.log`, `-3.log`) |
| `nx run-many -t test -p <20 projects> --parallel=1 -- --maxWorkers=2` | 56 of 58 passed. chat: 1 failure (my fixture change, fixed; full chat re-run 2631 passed, 0 failed). rpc-handlers: 1 failure, `harness-skill-selection-rpc.service.spec.ts` `never writes state.json` (precondition `existsSync(statePath)` is already true); reproduces in isolation, file untouched by this task: **not fixed, reported** |
| `nx build ptah-extension-webview` | 3.32 MB initial (error budget 3.5 MB) |
| Gate G / settings folder / marketplace+thoth+boot | see above; marketplace crash `code=3221226505` did not reproduce |

## Not run / not done

- Review accepts (the batch's last verification line) is not mine to decide.
- The tour did not use the default authenticated profile or generated narration; the docs shot used a profile copy.
- No test for the new `ConfigWatcher` finding; no commit; `batches.md` untouched; nothing deleted (lane probe files left in place).
- Open question for the orchestrator: whether the 6 docs-shot PNGs in `%TEMP%\b37-docs-shots` (new Orchestration UI) should replace the committed ones.

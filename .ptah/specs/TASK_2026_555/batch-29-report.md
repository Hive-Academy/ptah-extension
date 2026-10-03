# Batch 29 report: pure derivations, CLI matrix rows and permission notes (S6)

Executor: frontend-developer, Orchestration owner (in-process subagent). Date: 2026-10-01. Base: HEAD `46fda2e5f` (28d).
Nothing is staged or committed. No `git stash`, restore, checkout, reset or clean was used. No capture or `baseline-*`
file was written.

| Requirement | State |
| --- | --- |
| `cli-matrix-rows.ts`: order, installed/uninstalled split, instance status, key status and tier badges | Done |
| `cli-permission-notes.ts`: copy for every CLI id, plus `PENDING_USER_REVIEW_IDS` | Done |
| Every CLI id has copy | Done (compile-time `Record` plus a spec over `SYSTEM_CLI_TYPES` + `ptah-cli`) |
| No "Quota reached" state (D11) | Done |
| Cursor stays actionable in the Uninstalled group | Done |
| `ptahCliId` detection rows skipped; instances come from `cliAgents()` | Done |

All paths below are relative to `libs/frontend/chat/src/lib/settings/ptah-ai/`. Neither file is imported by any
component yet. The matrix component that uses them lands in Batch 30.

---

## 1. `cli-matrix-rows.ts` (249 lines)

`cliMatrixRows(sources)` at `:239` returns `{ installed, uninstalled }`. Its sources are the section data from the
state service: `orchestration()`, `cliAgents()`, `cliModels()` and `cliTest()`. A section that has not loaded is
`null` and adds no rows. The component shows that section's loading or error state itself.

### Order and grouping (#71)

- **Installed group:** installed system CLIs in detection order, then every Ptah instance in `cliAgents()` order.
  The group is then ranked by `preferredAgentOrder` (`byPreferredOrder`, `:226`).
- **Rank rule:** copied from `agent-orchestration-config.component.ts:380-389`. A row's rank is its index in the
  preferred list. Unranked ids sort after every ranked one, and the sort is stable, so ties keep input order.
  Unknown ids and duplicates in the list are harmless (first index wins).
- **Uninstalled group:** system CLIs that detection reports as not installed, in detection order (`:247`). They are
  never ranked into the installed list.
- **Skipped detection rows:** rows with a `ptahCliId`, non-system `cli` values and duplicate detection entries are
  skipped (`:156`). Instances come only from `cliAgents()`.
- **Missing CLIs:** a system CLI that detection does not report is not invented as "Not installed". The status
  shows only what detection reports (D11). `CliDetectionService.detectAll` reports every registered adapter, so in
  practice all six CLIs are present.

### System rows (D11)

- **Status (`:163`):** one of four values, all from detection:
  - Ready: installed and enabled
  - Disabled: listed in `disabledClis`
  - Not installed
  - Needs API key: Cursor only, when not installed

  A CLI that is both uninstalled and in `disabledClis` stays "Not installed". There is no quota state and no
  system-CLI test result; the spec asserts that system rows have no `lastTest` field.
- **Cursor (`:179`, `:174`):** `credentialAction: true` on both the installed and the Uninstalled row. This follows
  `cursor-cli.adapter.ts:208-223`: Cursor reports `installed` only once a key resolves. The version `sdk` from the
  bundled SDK is hidden.
- **`interactive` (`:173`):** `installed && enabled`. Batch 30 renders a disabled or not-installed row as plain text.
- **Model and effort:** each system row carries its setting key and saved value, for example
  `{ key: 'codexModel', value }`. Effort is `null` for Cursor, Antigravity and opencode, which have no effort setting.
  Pi uses `piReasoningEffort`. A missing optional field reads as `''`, the CLI default.
- **Provider (`:175`):** Codex → OpenAI Codex, Copilot → GitHub Copilot, Cursor → Cursor, Antigravity → Google
  Antigravity (from the `agy` adapter header). opencode and Pi take the provider from their `provider/model` id, so
  it is `null` until a model is saved. Uninstalled rows have no provider (the prototype shows "None").

### Instance rows

- **Status (#43, `:204`):** `available` → Ready, `error` → Error, `initializing` → Initializing, `unconfigured` →
  Needs API key. Each has a dot tone for the badge colour. An instance that is switched off shows Disabled,
  whatever its runtime status.
- **Key status (#44, `keyStatus` `:185`):**
  - `hasStoredKey` → "Key set".
  - `hasApiKey` without a stored key → "Cloud sign-in" for `ollama-cloud`, "No key needed" otherwise (local
    providers). This replaces the old "Cloud (signin)" label.
  - Otherwise → "No API key".
- **Tier badges (#54, `:210`):** read from `cliModels[id].tierMappings` and shown in Sonnet, Opus, Haiku order.
  Blank mappings are dropped.
  - `[]` means the instance has an entry but no tier is mapped.
  - `null` means `cliModels` has not loaded, or has no entry for this instance. It is never shown as "no tiers".
- **`selectedModel`:** `''` means the tier mappings decide. `null` means the model is unknown.
- **`lastTest` (#52, `:217`):** taken from `cliTest()` only when its `id` matches this instance.

---

## 2. `cli-permission-notes.ts` (75 lines)

`cliPermissionNote(cli, copilotAutoApprove = null)` (`:71`) returns `{ badge, tone, detail }`. The tone colours the
badge only; the copy stays `text-base-content` (deviation 6). The copy table is a `Record` over `CliType`
(`FIXED_NOTES` `:23`, plus Copilot), so a new CLI id without copy fails the type check.

### Copy restored from before #575 (#70)

This wording is from `git show 7ecdefa45^1:…/agent-orchestration-config.component.ts` at the lines `batches.md`
cites. The badges follow `prototypes/final/orchestration.html`.

| CLI | Badge | Detail |
| --- | --- | --- |
| codex | Full auto | Full auto — Codex runs headless with full access. |
| cursor | Full auto | Full auto — Cursor runs headless with full access. |
| antigravity | Full auto | Full auto — Antigravity runs headless with full access. |
| opencode | --auto flag | Full auto — opencode runs headless with --auto. |
| pi | No MCP / gate | No approval gate and no MCP support — Pi always runs tools with full process permissions. |

### NEW copy for the user to review (`PENDING_USER_REVIEW_IDS = ['copilot', 'ptah-cli']`, `:17`)

| Id / state | Badge | Detail | Source of the facts |
| --- | --- | --- | --- |
| copilot, auto-approve on | Auto-approve: On | Copilot runs every tool call without asking for approval. | `copilot-permission-bridge.ts`, `fullAuto` preset |
| copilot, auto-approve off | Auto-approve: Off | Copilot runs read-only tools without asking. Every other tool call waits for your approval. | `readOnly` preset: read-only tools and `read` requests |
| copilot, not loaded | Auto-approve: unknown | The saved Copilot auto-approve setting has not loaded, so its permissions are unknown. | No guess; the host default is on |
| ptah-cli | Follows Autopilot | Uses the chat's Autopilot setting. With Autopilot off, each tool call waits for your approval; Auto-edit approves file edits only; Plan Mode is read-only; Full Auto approves every action. | `ptah-cli-registry.ts:1280-1335` `resolvePermissionOptions`; labels from `autopilot-popover.component.ts:204-207` |

**Deviation from the prototype:** the prototype's Ptah-instance copy ("Sandboxed Port", "Runs in an isolated child
process … restricted to configured workspace root") is not used. The code does not support it: a Ptah instance runs
through the Agent SDK with the chat's permission level, and YOLO maps to `bypassPermissions`. The replacement copy
above goes to the user with the Batch 36 visual review, as the plan requires.

---

## 3. Specs

| Spec | Tests |
| --- | --- |
| `cli-matrix-rows.spec.ts` | 31: nothing loaded (1), order and grouping (7), system rows (11), instance rows (12, incl. all 4 statuses via `it.each`) |
| `cli-permission-notes.spec.ts` | 15: each of the 7 ids has copy (`it.each`), old wording kept verbatim, prototype badges, Copilot on/off/unknown, the Copilot value ignored for other ids, Ptah copy, `PENDING_USER_REVIEW_IDS` exactly `copilot` + `ptah-cli`, no "quota" anywhere |

The fixture `PROTOTYPE` in the rows spec is the `prototypes/final` data set without the quota state.

- Its installed order is `codex, antigravity, glm-1, copilot, opencode`, and the uninstalled order is `cursor, pi`.
- This matches the prototype (preferred order Codex → Antigravity → Glm → Copilot), except that OpenCode, which is
  unranked, sorts last.

---

## 4. Verification

| Command | Result |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview` | Successfully ran typecheck, lint for 5 projects |
| `npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui ptah-extension-webview --output-style=static -- --maxWorkers=2` | chat 125 suites, 2082 passed + 2 skipped (28d: 2036, +46 new); core 36 / 1109; ui 31 / 615; webview 11 / 224. All green |
| `npx eslint libs/frontend/chat/src/lib/settings/ptah-ai/cli-*.ts` | 0 problems (5 non-null-assertion warnings in the first draft of the spec were removed) |
| `npx tsc -p libs/frontend/chat/tsconfig.spec.json --noEmit` | 0 errors in the four new files. The project has 256 errors elsewhere: the known spec type-check gap ("Follow-ups") |

- `@ptah-extension/webview-e2e-harness` has no `test` target, so it was left out of the test run.
- Typecheck and test ran as separate commands (execution default 11).
- **Not run: `nx build ptah-extension-webview`, Gate G and the smoke captures.**
  - Neither new file is imported by any component, so the webview bundle and the rendered page are unchanged, and
    Gate G cannot change either. The bundle stays at 3.48 MB initial.
  - The build and Playwright are a single-writer resource shared with other agents (execution default 4). The
    team-leader's serial commit-time Gate G run covers this batch.
  - No `current-orchestration-*` capture was refreshed. The four untracked ones on disk predate this batch.

## 5. Risks and notes

- **New permission copy:** flagged in code (`PENDING_USER_REVIEW_IDS`) and listed in §2 for the user, as the
  validation notes require.
- **Interim notes from Batch 18:** not touched in this batch, and tracked for the Batch 36 gate:
  1. The header has no workspace name on a first landing on Advanced or Search & Voice.
  2. The legacy "Manage … in Providers" label goes away in Batch 33.
- **For Batch 30:**
  - Status and permission rows carry a `tone` for the badge or dot colour and a label for the text.
  - The system-row model and effort `key`s are the `agent:setConfig` field names, so a cell pick can pass
    `{ [row.model.key]: value }` to `state.saveSettings({ orchestration })`.
  - The unsupported-effort guard stays in the popover (Batch 30), not in the rows.

## 6. Out-of-scope observations

- Old #77 install copy covers only Codex (`npm install -g @openai/codex`) and Copilot (`npm install -g
  @github/copilot`). Batch 30's install-guide ℹ for Cursor, Antigravity, opencode and Pi has no old wording to
  restore. The prototype's Pi command (`@inflection/pi-cli`) contradicts the adapter, which names
  `@earendil-works/pi-coding-agent`. Batch 30 needs either new copy, flagged for the user, or the ℹ only where copy
  exists.

## Files

- CREATED `libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts`
- CREATED `libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.spec.ts`
- CREATED `libs/frontend/chat/src/lib/settings/ptah-ai/cli-permission-notes.ts`
- CREATED `libs/frontend/chat/src/lib/settings/ptah-ai/cli-permission-notes.spec.ts`
- CREATED `.ptah/specs/TASK_2026_555/batch-29-report.md` (this file)

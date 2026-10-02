# Batch 28d report: key hint, Overview latency, Codex CLI under "Used by"

Executor: frontend-developer, Providers owner (in-process subagent). Date: 2026-10-01. Base: HEAD `7788993b3` (28c).
Nothing is staged or committed. No `git stash`, restore, checkout, reset or clean was used. No `baseline-*` file was
written (`git status -- screenshots/angular/` shows 0 baseline entries).

Contract used: `batch-28c-report.md` "Shapes (the contract for 28d)" and "Revise round 1", not the guesses in
`batches.md`. The fields are `keyHint?` on `auth:getApiKeyStatus` entries, `apiKeyHint?` on `auth:getAuthStatus`,
`lastCheck?: ConnectionCheckRecord` on `auth:getEffectiveRoute` providers, and `auth:checkConnection { providerId }`.

| Requirement | State |
| --- | --- |
| Key hint in the Credentials stored-key row | Done |
| Key hint in the Overview "Credential storage" row (prototype) | Done |
| Overview latency + relative time of the last check | Done |
| Drawer "Check connection" through `auth:checkConnection` (local connections keep the route refresh) | Done |
| "Codex CLI" under "Used by" for OpenAI Codex ("Used by 2") | Done |
| Gate G entries GV28-1..3, `EXPECTED_CAPABILITY_COUNT` 91 → 94 | Done |

All paths below are relative to the worktree root.

---

## 1. Key hint

### Rendering

**Credentials tab:** `libs/frontend/chat/src/lib/settings/providers/connection-drawer/credentials-tab.component.ts:183-189`.

- With a stored key and a hint, the row shows the hint (`•••• 8f21`).
- With a stored key and no hint, it keeps the fixed 16-bullet mask it showed before 28d. This is the existing
  stored-key wording, and no placeholder is added.
- With no stored key, it shows "No key stored". A hint that arrives without `hasKey` is never shown (spec).
- The span is `select-none`, has no copy control, and stays `text-base-content`.

**Overview tab:** `connection-drawer/overview-tab.component.ts:188-195`.

- The "Credential storage" value reads `•••• 8f21 (stored on this machine)`, as in the prototype.
- The hint part is `font-mono select-none` (`data-testid="connection-key-hint"`).
- Without a hint, the row keeps `credentialLabel` ("Stored on this machine").
- The drawer passes the hint only for `api-key` and `custom` connections that have a stored key
  (`connection-detail-drawer.component.ts:220-224`, bound at `:87`).

### Display only

- The hint is never a parameter of any RPC. It is not placed in a copy action and nothing logs it.
- `hostKeyHint` (`libs/frontend/core/src/lib/services/providers-settings-sections.ts:107-116`) validates host data
  where it enters state. It accepts only `/^•{4} \S{4}$/u` (four U+2022, a space, 4 code points).
  - Anything else is dropped: a whole key sent by mistake, a longer tail, three bullets, a non-string.
  - So the view cannot show more of a key than the 28c contract allows, even if the host misbehaves.

### Read path

1. **RPC fields.**
   - `auth:getApiKeyStatus` returns `providers[].keyHint`.
   - `auth:getAuthStatus` returns `apiKeyHint` (Claude API key).
2. **State.** `ProvidersSettingsStateService.readConnections` builds each connection with `...hostKeyHint(...)`:
   - provider rows at `providers-settings-state.service.ts:306`, only when `hasApiKey`;
   - the Claude API row at `:317`.
3. **Type.** The value is `ProvidersConnection.keyHint?` (`providers-settings.types.ts:144-149`).
4. **Templates.** Credentials reads `connection().keyHint`. Overview reads `[keyHint]="overviewKeyHint()"`.

---

## 2. Overview latency and the drawer's "Check connection"

### Wiring

The drawer's Check previously refreshed the whole page through `state.checkConnection()`, which is a route re-read. It
now checks the one connection.

1. **Parent.** `providers-settings.component.ts:211` binds
   `(checkConnectionRequested)="state.checkProviderConnection(connection.id)"`.
2. **Facade.** It delegates to the existing collaborator in two lines (`providers-settings-state.service.ts:322-324`).
   The facade is **699 lines** (≤ 700).
   - Space was made by removing two duplicate blank lines.
   - The new logic lives in `ProvidersConnectionSetupService`, per the facade rule.
3. **`ProvidersConnectionSetupService.checkConnection`** (`providers-connection-setup.service.ts:102-127`).

   For a connection the host can check (`hostCheckable`):
   - It sets `{ providerId, status: 'checking' }`.
   - It calls `auth:checkConnection { providerId }` with a 35 s timeout (`:48`, the same budget as
     `auth:verifyDraftConnection`).
   - It then calls `hooks.refreshRoute()`.
   - Only after that re-read does it publish `done` or `failed`. "Checking…" therefore lasts until the recorded
     result can be shown.
   - A generation counter means the latest check wins. An earlier check that settles late publishes nothing.

   For any other connection, it runs `hooks.refreshRoute()` alone, as before. That covers:
   - local servers (Ollama, LM Studio),
   - Ollama Cloud (key-optional),
   - an unknown id.

   `auth:testConnection` is never called.
4. **`hostCheckable`** (`:442-453`) mirrors the host's `connectionCheckKind`
   (rpc-handlers `connection-check.ts:60-74`). The checkable connections are:
   - `anthropic`,
   - custom entries,
   - `nativeAuth` (Claude CLI),
   - GitHub Copilot and OpenAI Codex,
   - `authType` `'apiKey'` and not `isLocal`.

   The frontend's `connectionKind` could not be used for this decision. Ollama Cloud is `authType: 'none'` with
   `isLocal: false`, so the drawer classifies it as `api-key`, but the host refuses to check it.
5. **Failure (D15).** A failed `auth:checkConnection` sets `failed`. `require()` throws fixed text, so no host text
   enters state.
   - `drawerStatus` (`providers-settings.component.ts:466-471`) maps `failed` for this connection to `check-failed`,
     shown as "Check failed" plus "Retry check".
   - A failed route read also maps to `check-failed`, as before.
   - Another connection's check never affects this drawer (spec).

### Rendering

- `overviewCheckApplies` and `overviewCheckedStatus` are in `overview-tab.component.ts:84-108`.
- Rules for a **verified** record:
  - It confirms a success line or a "no verdict" line (`CHECK_CONFIRMABLE`, `:67-69`) as "Connected & verified".
    "Active for main agent" keeps its own label.
  - The latency is appended as ` (92ms)`, in whole ms.
  - No latency is shown when `latencyMs` is `null` (CLI and sign-in connections), 0, negative or non-finite. The line
    never reads "0ms".
  - A warning or error from the current route ("Unreachable", "Needs API key", …) is never overridden by an earlier
    check.
- Rules for a **failed** record:
  - The line reads "Check failed" with an error dot. It never says "verified" (D15).
  - The fixed reason copy (`CHECK_FAILURE_COPY`, `:72-86`, covering all 13 `ConnectionCheckFailureReason` values) goes
    on the line below.
  - An unknown reason falls back to "The check failed.". The host value is never rendered (`Object.hasOwn` guard).
- A running check ("Checking…") or a failed check request wins over any record. The record line is hidden meanwhile.
- **Relative time:** a muted secondary line under the status (`:167-170`).
  - It reads "Checked just now", "Checked N min ago", "Checked N h ago" or "Checked on <date>" (`checkedAgo`,
    `:110-120`).
  - `title` carries the full local time.
  - There is no line when there is no record, or when the time is unreadable.
  - The status line itself still reads as in the prototype ("Connected & verified (92ms)").
- **Colour:** only on the dot. The status text stays `text-base-content` and the time line is `text-base-content-muted`
  (deviation 6, spec).
- **Timer:** one 30 s interval refreshes the age, and only while a record is shown (`:302-312`). It is released when
  the record goes and when the tab is destroyed (spec).
  - It runs outside the Angular zone, following `chat-ui/.../streaming-quotes.component.ts:103`. The app uses zone.js
    (`app.config.ts:131`). Inside the zone, the interval kept the app unstable, which a parent spec exposed as a
    `whenStable` hang.
  - The signal write still schedules the render.
- **Accessibility:** the status block is `aria-live="polite"` (`:158-159`), so a finished check and its latency are
  announced.
- **Checking state:** the drawer's `checking` input is `route loading || drawerCheckRunning(id)`
  (`providers-settings.component.ts:205`, `:472-475`). The button is disabled and reads "Checking…".

### Read path

1. **Control.** Overview "Check connection".
2. **Parent and facade.** `state.checkProviderConnection(id)` calls `setup.checkConnection`.
3. **RPC.** `auth:checkConnection { providerId }`. The host probes and records (28c `ConnectionCheckRecorder`).
4. **Route re-read.** `hooks.refreshRoute()` reads `auth:getEffectiveRoute { refresh: true }`. The route store passes
   `providers` through unchanged (`providers-settings-state.service.ts:201`).
5. **State.** The record is `state.route().data.providers[i].lastCheck`.
6. **Parent read.** `lastCheckOf(id)` (`providers-settings.component.ts:477-479`).
7. **Drawer and Overview.** `[lastCheck]` → `overviewCheckedStatus` / `checkDetail`.

---

## 3. "Codex CLI" under "Used by" (Batch 19 decision (a) reversed)

- **Note updated.** `connection-usage.ts:94-101` now cites task.md "Gate V 28 (2026-10-01, user)" in place of the
  Batch 19 note.
- **New source.** `ConnectionUsageSources.systemClis` (`connection-usage.ts:32-37`) carries `detectedClis` and
  `disabledClis` from `agent:getConfig`. It is `null` while that read loads or after it failed.
- **Enabled rule.** `codexCliEnabled` (`:42-46`): installed, not in `disabledClis`, and not flagged
  `disabled` by detection.
- **Entry.** `{ id: 'codex-cli', label: 'Codex CLI', kind: 'system-cli' }` is added to **`openai-codex` only**, after
  the Ptah CLI agents (`:103-105`). Copilot, Cursor and the other CLIs are never listed (spec).
- **Loading.** `complete` now also needs `systemClis !== null` (`:107-110`). While the CLI read loads, the card shows no
  count and the drawer shows "Loading…" (Batch 20 rule, spec).
- **Errors.** `usageError` includes `state.orchestration()` (`providers-settings.component.ts:360-362`). A failed CLI
  read shows the existing error with Retry rather than "Loading…" forever.
- **Overview row.** `KIND_DETAIL['system-cli']` = "Uses this sign-in" (`overview-tab.component.ts:131`). The badge
  reads "Active (Codex CLI)". There is no "Follows main agent" link, and `openRole` ignores it.
- **Source wiring.** `providers-settings.component.ts:348-358` passes `state.orchestration()`, which is the existing
  `agent:getConfig` read (`providers-settings-state.service.ts:478-493`). No new RPC was added.
- **Fixtures.** The BRIEF data has Codex installed and Copilot disabled (`AGENT_CONFIG_FIXTURE`), so OpenAI Codex reads
  "Used by 2" (memory curator + Codex CLI), as in the prototype.

---

## 4. Harness

**`settings.fixtures.ts`:**

- `MOONSHOT_KEY_HINT` and Moonshot's `keyHint` (`:60-67`).
- `FixtureState.connectionChecks`, seeded with a Moonshot verified record (92 ms, boot time) (`:422`).
- `auth:getEffectiveRoute` became a resolver that attaches `lastCheck` (`:474-482`).
- `auth:checkConnection` resolver (`:266-276`):
  - It records the call and stores a verified record. Latencies: Moonshot 92, sovereigneg 140, CLI and sign-in `null`.
  - It leaves local ids unanswered, as the real host refuses them.
- The Codex CLI is already enabled in the BRIEF fixture.

**`settings-reachability.table.ts`, entries `:908-939`:**

- **GV28-1:** Moonshot Credentials mask = `•••• 8f21`, and the Overview `connection-key-hint` plus
  "(stored on this machine)".
- **GV28-2:** sovereigneg Overview reads exactly "Connected & verified". After "Check connection":
  - the `auth:checkConnection {providerId:'sovereigneg'}` call is asserted;
  - the status reads "Connected & verified (140ms)";
  - the time line reads "Checked just now".
- **GV28-3:**
  - the OpenAI Codex card reads "Used by 2";
  - the drawer has `[data-used-by="codex-cli"]` with "Codex CLI";
  - the count reads "2 active routes".
- `EXPECTED_CAPABILITY_COUNT` 91 → **94** (`:974`).

The visual spec is unchanged. The seeded record puts the latency into `current-drawer-moonshot-*` without a click.

---

## 5. Unit specs added or changed

| File | What it proves |
| --- | --- |
| `chat/.../connection-usage.spec.ts` | Prototype: OpenAI Codex = memory curator + Codex CLI. No other system CLI anywhere. Not listed when switched off, flagged disabled, not installed or not detected. An unloaded `systemClis` keeps the result incomplete |
| `chat/.../overview-tab.component.spec.ts` | `overviewCheckedStatus` table (12 cases): 92ms format, whole ms, `null`, 0 and NaN give no latency, a route warning is kept, failed gives "Check failed", checking and check-failed win. `checkedAgo` (8 cases). Component: latency and time in base-content text; no record means no latency and no line; failed shows fixed reason and never "verified"; an unknown host reason gives fixed copy; checking hides the record; one 30 s timer, refreshed, cleared on destroy and when the record goes; no timer without a record; key hint `select-none` with no copy control, label kept without a hint; Codex CLI row with detail and badge, no role link |
| `chat/.../credentials-tab.component.spec.ts` | Hint shown, `select-none`, no copy control; a hint without a stored key is not shown; fixed mask kept without a hint |
| `chat/.../providers-settings.component.spec.ts` | Drawer Check calls `checkProviderConnection('second')`, never the page refresh. The route's `lastCheck` gives "Connected & verified (92ms)" and "Checked just now", only for that connection. Its own `checking` gives "Checking…" and a disabled button; `failed` gives "Check failed" and "Retry check"; another connection's failure does nothing. Overview hint row. Codex "Used by" waits for the CLI read, then "Used by 2", then 1 when the CLI is switched off |
| `core/.../providers-settings-sections.spec.ts` | `hostKeyHint` keeps the shape (an astral last char counts as one) and drops 9 bad shapes, including a whole key |
| `core/.../providers-settings-state.service.spec.ts` | `keyHint` / `apiKeyHint` are mapped. A whole key, a long tail and a hint without a key never enter state; the serialised state has no key text |
| `core/.../providers-connection-setup.service.spec.ts` | 5 checkable kinds call `auth:checkConnection` (35 s) and then the route re-read, in that order. Custom entries are checkable. Ollama, LM Studio, Ollama Cloud and an unknown id get the route re-read only, with no RPC. "checking" lasts until the re-read ends. A failed RPC gives `failed` with no host text, and still re-reads. The latest check wins |

---

## 6. Verification

Logs are in `%TEMP%` (`C:\Users\abdal\AppData\Local\Temp\`).

**Batch 17 command.** The first attempt passed `-- --maxWorkers=2` to every target, so `tsc` rejected it
(`TS5023 Unknown compiler option`). That was a command error, not a code failure. The command was split:

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview --parallel=2`
  → "Successfully ran targets typecheck, lint for 5 projects" (`b28d-verify-tl.log`).
- `npx nx run-many -t test -p <same> --parallel=2 -- --maxWorkers=2`
  → "Successfully ran target test for 4 projects" (`b28d-verify-test.log`).
  - The harness has no test target.
  - chat and ptah-extension-webview ran fresh. core and ui matched the cache from the identical first run's test phase.
- Direct jest counts:
  - chat `settings/providers`: **19/19 suites, 507/507 tests** (`b28d-chat-providers3.log`);
  - core `providers-*`: **4/4 suites, 218/218** (`b28d-core.log`).

**Build.** `npx nx build ptah-extension-webview` exited 0 with **no budget error** (`b28d-build.log`).

| | Before (28c, `b28c-tl-build.log`) | After |
| --- | --- | --- |
| Initial total | 3.48 MB | 3.48 MB |
| Over the 2.5 MB warning | 976.07 kB | 978.64 kB |
| Change | | **+2.57 kB** |

- The margin to the 3.5 MB error budget is about 21.4 kB.
- The added eager code is the setup-service check, the usage rule and the parent bindings.
- The Overview and Credentials changes stay in the drawer's deferred chunk.

**Gate G.** Run with `--reporter=list`.

- First run: **9 passed** (1.6 m), both hosts (`b28d-gateG1.log`).
- `--repeat-each=3`: **27 passed** (2.1 m) (`b28d-gateG-r3.log`).
- No failure occurred, so there was nothing to diagnose.

**Full settings folder** (`src/lib/scenarios/settings`, both hosts and both themes): **40 passed, 2 skipped**
(`b28d-settings-folder.log`).

- The 2 skips are the pre-existing `fixme` "deep link main-model opens the popover on the model control" (vscode and
  electron), carried from 28b.
- Every Providers fold assertion is green:

| Host / theme | tabs | map | heading | card 5 | Card heights | Columns |
| --- | --- | --- | --- | --- | --- | --- |
| vscode / anubis and anubis-light | 83 | 354 | 398 | 590 | all 80 | 3 at 1024 |
| electron / anubis and anubis-light | 123 | 503 | 547 | 831 (below the fold by decision) | all 80 | 2 at 1024 |

- There is 0 px horizontal overflow at 800 px.
- "Used by 2" is the same width as "Used by 1", so card height is unchanged.

---

## 7. Captures

All are `current-*` in `.ptah/specs/TASK_2026_555/screenshots/angular/`, written by the folder run. I looked at each
one against `prototypes/final/screenshots/interactions/drawer-moonshot.png` and `index-anubis-1024x768.png`.

| Capture (× vscode/electron × anubis/anubis-light) | What it shows |
| --- | --- |
| `current-drawer-moonshot-*-1024x768.png` | Matches the prototype: green dot, "Connected & verified (92ms)", muted "Checked just now", "Check connection" on the right. "Credential storage: •••• 8f21 (stored on this machine)" in mono. Used by: Judge lane / Active (Judge) |
| `current-drawer-moonshot-credentials-*-1024x768.png` | Stored API key row "•••• 8f21" with Replace and Delete key |
| `current-providers-*-1024x768.png` | OpenAI Codex card "Used by 2", Moonshot "Used by 1", fold layout unchanged |

Prototype differences:

- The text stays base-content, not green, per deviation 6.
- The time line is an addition the batch asked for.

The folder run also rewrote the other `current-*` captures (main-agent popover, catalog, other drawers). They are
unchanged in content. No `baseline-*` was written.

---

## 8. Deviations

1. **Overview hint row.** The key hint is also in the Overview "Credential storage" row, which the prototype shows and
   `batches.md` did not name (orchestrator instruction).
2. **The hint's literal form.** The Edit tool wrote the hint literals as UTF-8 U+2022 characters (`E2 80 A2`) rather
   than `\u2022` escapes:
   - `providers-settings-sections.ts:108` regex;
   - `settings.fixtures.ts:61`;
   - the specs.

   The files stay UTF-8 without a BOM (checked). The bytes are correct, and `credentials-tab.component.ts` already had
   literal bullets.
3. **The drawer's Check now checks one connection.** It no longer refreshes the whole page. The card grid's "Check
   connection" and "Retry" still use the page-wide route refresh (`providers-settings.component.ts:151-152`), which is
   outside this batch.
4. **Verified record versus route state.** A verified record never overrides a route warning or error. The route is
   the current state, and 28c clears a record on any key or endpoint change (S-1).

## 9. Out-of-scope observations

- **The connection card does not read `lastCheck`.** It shows the route status only. After a failed explicit check, the
  card can still read "Connected" while the drawer reads "Check failed". Carrying the record to the card is a design
  question for Batch 38.
- **Local connections with an optional key get no hint in Overview.** For Ollama and LM Studio, Overview keeps
  "Optional key stored on this machine". The host may send a hint, but the prototype has no such row.
- **The seeded Moonshot check time depends on run timing.** Its `checkedAt` is boot time, so a slow run can capture
  "Checked 1 min ago".
- **Batch 17 verify command.** The command with `-- --maxWorkers=2` fails `typecheck` in this Nx setup. Split it (as
  above) or drop the passthrough.

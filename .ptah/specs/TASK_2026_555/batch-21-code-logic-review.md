# Code Logic Review — `TASK_2026_555` Batch 21 (drawer Credentials tab)

## Verdict: APPROVED — 7/10

| Metric              | Value   |
| ------------------- | ------- |
| Overall score       | 7/10    |
| Assessment          | APPROVED (2 moderate findings to address in a follow-up) |
| Blocking issues     | 0       |
| Serious issues      | 0       |
| Moderate issues     | 2       |
| Minor issues        | 3       |

Scope read in full: `credentials-tab.component.ts` (new, 474 lines) and its spec, `connection-detail-drawer.component.ts` (+spec diff), `providers-settings.component.ts` (+spec diff), `settings-reachability.table.ts` (diff), `settings-visual.e2e.spec.ts` (diff), plus the write-path dependencies `providers-connection-setup.service.ts`, `providers-commit.service.ts`, `providers-settings-state.service.ts`, `providers-settings-sections.ts`, `connection-kind.ts`, and the host `auth:verifyDraftConnection` / `draft-verification.service.ts` branches the claims rest on.

---

## What the checklist asked, and what the evidence says

### 1. Replace = verify-then-save (plan :649-652) — HOLDS

- `save()` is the only emitter of `replaceKeyRequested`, and it is gated by `canSave` (`credentials-tab.component.ts:338-339`, `:421-426`): `probeState === 'verified'`, a non-empty draft, not busy, and `probeResult().probeId === this.probeId`.
- Any edit after a pass drops the probe (`onKeyInput` → `abandonProbe`, `credentials-tab.component.ts:388-392`), so the saved key is always the key that was checked.
- The state layer re-checks independently: `connectProvider` refuses an unverified draft via `verifiedFor` (`providers-connection-setup.service.ts:146-151`, `:406-410`), which requires the host probe store to hold this exact `probeId` with outcome `verified` for this provider. A stale or cancelled probe cannot pass.
- The `anthropic` rule holds: the tab offers Replace only while Claude API drives the main agent (`anthropicGuidance`, `credentials-tab.component.ts:334-336`), and `replaceKeyDraft` sends `activation: 'use-main-agent'` for `anthropic` (`credentials-tab.component.ts:57`), which is the only path the state accepts (`connectProvider` blocks `anthropic` + `connect-only`, `providers-connection-setup.service.ts:146`).
- Failed verify: Save stays disabled, fixed reason copy plus latency show, and the host `detail` never renders (`PROBE_FAILURE_COPY`, `credentials-tab.component.ts:62-74`, `:340-349`). A rejected check call becomes a local `unclassified` failure (`:413-418`). Pinned by specs at `credentials-tab.component.spec.ts:136-168`.

### 2. D15 — HOLDS, with an unusually clean design

The tab never sees `state.commit()` directly. It sees only `drawerCommit`, which the parent copies once, after its own write resolved (`providers-settings.component.ts:521-532`). An earlier page save cannot appear as the tab's outcome, and a refused write (`false` from `ProvidersCommitService.run` / `connectProvider`) becomes the fixed "Another save is in progress. Retry when it finishes." message, never "Saved". Pinned at `providers-settings.component.spec.ts:238-253` and `credentials-tab.component.spec.ts:185-203`.

### 3. Delete key — HOLDS

Inline confirm before the emit (`credentials-tab.component.ts:234-249`, `:428-432`); the active-driver warning text "New requests fail until a key is added." (`:237-242`); write via `state.deleteStoredKey` → `auth:deleteStoredKey` with a read-back and the post-save `hooks.refresh()` inside `ProvidersCommitService.run` (`providers-connection-setup.service.ts:306-314`, `providers-commit.service.ts:347`), so the card and Overview re-read and show needs-key. No auth-method write, no SDK reset (D4).

### 4. Copilot / Codex / claude-cli / Ollama — HOLDS

Copilot account + Sign out → `disconnectCopilot` (`credentials-tab.component.ts:116-143`, `:434-438`); Codex token-stale copy and Open login → `performExternalAuth('sign-in')` (`:144-157`); claude-cli login/install copy with Copy and Check again (`:98-114`); Ollama optional-key copy and an https-only `helpUrl` with `rel="noopener noreferrer"` (`:193-200`, `:324-327`).

### 5. Secrets — HOLDS

The typed key lives only in `keyDraft`; cleared on destroy (`DestroyRef`, `:376`), on a saved Replace (`:373-375`), on Cancel, and when another connection opens (id-keyed effect, `:364-371`). A running check is cancelled on the host on every one of those paths (`abandonProbe`, `:465-473`). The stored key is a fixed mask (`:177`). No key value reaches a DOM attribute, log, toast, or error text: the host `detail` never renders, `require()` throws a fixed message (`providers-settings-sections.ts:111-120`), and `abortProbe` logs only that fixed-message error. Spec keys are obvious fakes (`sk-new`, `sk-secret`).

### 6. Concurrency — HOLDS on every asked interleaving

- Double-click: the confirm panel is destroyed by the first click (`confirming.set(null)` before the emit), and `drawerCommit` flips to `saving` synchronously inside the same event dispatch (`confirmDelete` → parent `drawerWrite` sets `saving` before its first `await`).
- Save while another save runs: buttons disable through `busy()` (`saving()` input plus `commit().status === 'saving'`), and `ProvidersCommitService.run` refuses re-entry with `false` (`providers-commit.service.ts:306`), which `drawerWrite` reports as "Another save is in progress".
- Drawer closed mid-save: `closeDrawer` clears `drawerCommit` (`providers-settings.component.ts:506`); the write continues; the page-level `providers-commit-feedback` block (`:235-243`) shows the outcome per plan §5; a reopen resets `drawerCommit` (`:503`).
- Connection switched mid-edit: the tab resets the typed key, the confirm, and `pendingWrite` on an id change (`credentials-tab.component.ts:364-371`), and a new tab instance starts with `pendingWrite = null`, so a write started for connection A cannot display its outcome on connection B.

### 7. D14 — HOLDS

`CREDENTIALS_COMPLETE` = api-key, oauth, claude-cli (`connection-detail-drawer.component.ts:66`); those kinds drop "Edit in setup" only on the Credentials tab. `local` (optional key, base URL) and `custom` (endpoint) keep it (`:227-230`), and Models & Tiers / Advanced keep it for every kind, so no edit path is unreachable. A built-in api-key provider's endpoint (editable in the wizard) stays reachable through the Models & Tiers fallback.

### 8. Harness — REAL

- #7, #8, #12, #49 are `restored` with reaches that click Manage, open the drawer, take the Credentials tab, perform the inline two-step confirm, and assert the RPC params from the fixture call log (`settings-reachability.table.ts:814-820`, `:829`, `:844`).
- RUX-1 is a behavioural reach, not a smoke test: `INVALID_PROBE_KEY` drives a real failed fixture probe, asserts "Nothing was saved" and Save disabled, then a valid key verifies and enables Save (`:870-889`). RUX-4 and RUX-10 are also real (`:890`, `:896`).
- `EXPECTED_CAPABILITY_COUNT` 81 → 84 grows only (`:947-952`); `BASELINE_PRESENT_IDS` is untouched and the spec still asserts 64 (`settings-reachability.e2e.spec.ts:52-53`).
- Manage on the Claude API card has no side effect: it opens the drawer, whose open does only `refreshConnectionSetup` reads (`providers-settings.component.ts:499-505`). The previous wizard-based Manage for `anthropic` is replaced by a drawer that follows plan :649-652, and the wizard path remains reachable through the guidance copy.

### 9. Specs assert behaviour — HOLDS

The tab spec drives a `ProbeHost` with manually settled promises and asserts probe params, disabled states, emitted events, cancel calls, and commit copy (`credentials-tab.component.spec.ts:20-32`, `:121-203`). The parent spec asserts the actual `connectProvider` draft shape, D15 ownership, and refusal copy (`providers-settings.component.spec.ts:210-253`). The drawer spec asserts the relay and the footer fallback matrix.

---

## Five logic questions

### 1. How does this fail silently?

The one found: external-auth actions (Open login, Check again) give the tab no in-flight or failure feedback — see Finding 1. Everything else reports: probe failures, refused writes, blocked writes, unconfirmed writes, and read errors all land in fixed copy the user can see.

### 2. What user action produces unexpected behaviour?

Clicking "Open login" or "Check again" repeatedly while a sign-in RPC is slow: the buttons stay enabled, each click re-launches the RPC, and the drawer shows no sign anything is running (Finding 1). Also, a user with a broken Claude API key who opens the drawer to replace it finds Replace replaced by wizard guidance (Finding 2a).

### 3. What input data produces a wrong answer?

None found that corrupts data. Host shapes are typed and the untrusted ones are guarded (unknown custom protocol is dropped from the subtitle, `connection-detail-drawer.component.ts:206-209`; `helpUrl` must match `^https://`). The failure-copy table keys on a closed `ProbeFailureReason` union with an `unclassified` fallback (`credentials-tab.component.ts:346`).

### 4. What happens when a dependency fails?

- Verify RPC fails → fixed "Check failed" with `unclassified` copy; Save stays disabled (`credentials-tab.component.ts:413-418`).
- Write RPC fails → `settle` catches, no error text enters state, the write lands in `unsaved`/`unconfirmed` and the tab says "Not saved." (D15, `providers-commit.service.ts:381-407`).
- Cancel RPC fails → the host answers `{ cancelled: false }` rather than throwing (`auth-rpc.handlers.ts:1648-1673`); a superseded result can never publish (generation checks, `providers-connection-setup.service.ts:273-278`).
- A `run` rejection is the one unguarded branch (Finding 3), but no current code path rejects: `readSection` never rejects (`providers-settings-sections.ts:96-105`).

### 5. What is missing that the requirements never mentioned?

In-drawer feedback for external sign-in (Finding 1); a "driver" definition that survives a not-ready route (Finding 2). Both flagged deviations (key hint, Overview latency) were put to the orchestrator and are recorded for Gate V, which is the right handling.

---

## Findings

### 1. External-auth actions have no in-drawer in-flight or failure feedback — MODERATE

- File: `credentials-tab.component.ts:112-113` (Check again), `:155-156` (Open login), `:283` (`externalMessage` input), `:258-260` (render); `providers-settings.component.ts:257` (message passed only from ready data); `providers-settings-sections.ts:100-104` (`retainOnError` keeps previous data).
- Failure scenario: the user clicks "Open login" (Codex) in the drawer. `auth:codexLogin` fails or hangs (its timeout is 310 s, `providers-connection-setup.service.ts:115-121`). While loading, `externalAuth.data.message` is `null`, so nothing changes in the drawer; on error, `readSection` retains the previous data, so the tab keeps showing the previous attempt's message (e.g. "Sign-in detected…") after a failed re-check. The only failure text is the page-level alert (`providers-settings.component.ts:233`), which sits behind the modal drawer. The buttons are not disabled during the flight, so every click re-launches the login RPC.
- Suggested fix: pass the drawer's provider-matched `externalAuth` status (loading / error) into the tab; disable Open login and Check again while `loading`; on `error`, show a fixed "Sign-in could not be checked. Retry." line in the tab instead of the stale retained message.

### 2. `isActiveDriver` is derived from `activeId()`, which is null while saving or when the route is not ready — MODERATE

- File: `providers-settings.component.ts:345-348` (`activeId` requires `route.data.ready && !saving()`), `:251` (drawer binding `isActive`); `credentials-tab.component.ts:334` (`anthropicGuidance`), `:335-336` (`canReplace`), `:237-242` (active-driver delete warning).
- Failure scenario: (a) Claude API drives the main agent but its stored key is invalid, so `route.ready` is false → `isActiveDriver` false → the drawer hides Replace and shows the "Use Connect provider → Claude API" guidance exactly when the user most wants to replace the broken key from the drawer. The wizard path still works, so no capability is lost, but the drawer's own Replace is unreachable in that state. (b) During the Replace save itself, `saving()` makes `activeId()` null, so the "A new Claude API key is saved together with choosing Claude API" guidance paragraph flashes under the open form until the save resolves. (c) The delete-confirm's "drives the main agent" warning does not show for a configured-but-not-ready active driver.
- Suggested fix: bind `isActiveDriver` from `route.status === 'ready' && route.data.driverProviderId === connection.id`, without the `ready`/`!saving()` gates of `activeId()` (those gates are right for the card highlight, wrong for "who is the driver").

### 3. `drawerWrite` has no rejection guard; a throw latches the tab at "Saving…" — MINOR

- File: `providers-settings.component.ts:521-532`.
- Failure scenario: if `write(context)` ever rejects, `drawerCommit` stays at `saving`, so `busy()` (`credentials-tab.component.ts:337`) stays true and every tab control is disabled until the drawer is closed and reopened. No current path rejects (`readSection` never rejects; `settle` catches operation errors), so this is a robustness gap, not a live bug — but a single future `throw` in a refresh hook inside `ProvidersCommitService.run` would produce it.
- Suggested fix: wrap the `await write(context)` in try/catch and set `{ status: 'blocked', message: 'The save could not be completed. Retry.' }` on rejection.

### 4. The mid-flight interleavings are handled by design but not pinned by tests — MINOR

- File: `credentials-tab.component.spec.ts` (whole file); `providers-settings.component.spec.ts:208-266`.
- Failure scenario: "drawer closed mid-save then reopened" (no outcome may appear in the new tab), "Save clicked while a page save runs" (refusal copy), and "connection switched while a Replace save is in flight" all hold today through the per-instance `pendingWrite`, the `drawerCommit` reset in `openDrawer`, and the id-keyed reset effect. None is exercised by a spec, so a refactor of `drawerWrite` or the tab's effects could silently break them.
- Suggested fix: one parent-level spec that starts a drawer write, closes and reopens the drawer, and asserts no `credentials-commit` appears before a new tab action; one that starts a page save, then attempts a drawer write.

### 5. A failed setup read turns stored tiers into empty strings in the Replace draft — MINOR

- File: `credentials-tab.component.ts:46-59` (`replaceKeyDraft` maps a `null` setup to `''` tiers); `providers-settings.component.ts:370-374` (`credentialsSetup` null while the read is not ready or failed).
- Failure scenario: `refreshConnectionSetup` fails (RPC error) → `credentialsSetup` is null → the draft carries `''` for all three tiers. For a provider whose registry entry lacks a `defaultTiers` entry for some tier, `connectProvider` then blocks with "Choose explicit models where no provider default is available." (`providers-connection-setup.service.ts:182-185`) even though valid stored tiers exist — an honest "Not saved." with a message that points at the wrong cause. Providers with registry defaults (moonshot, most api-key providers) are unaffected, and the check still ran against the saved endpoint (`draft-verification.service.ts:520-524`: an `apiKey` draft with no `baseUrl` resolves the saved URL itself).
- Suggested fix: for a non-custom connection, keep the Replace form's Save disabled until `setup` is loaded, or surface the setup-read failure in the tab.

---

## Data flow (Replace, entry to exit)

1. Type key → `keyDraft` signal — OK (any prior probe is dropped on edit).
2. Check key → `verify()` builds `drawer-probe-N` params — OK (custom kind adds the stored endpoint; the id/probeId staleness check makes a superseded result inert, `credentials-tab.component.ts:409-418`).
3. Parent `verifyDraftConnection` → `state.verifyDraft` → host `auth:verifyDraftConnection` — OK (generation guard prevents a stale publish; the credential is transient and never logged, `auth-rpc.handlers.ts:1614-1631`).
4. Save key → `canSave` gate → emit `{key, probeId}` → drawer `emitReplace` → `replaceKeyDraft` — OK (credential-only draft, `editedTiers: []`, `connect-only` except `anthropic`).
5. Parent `drawerWrite` → `state.connectProvider` → `verifiedFor` gate → `auth:setApiKey` (or `auth:saveSettings` for `anthropic`) → read-back → post-save refresh — OK (a failed or unconfirmed write can never read back as saved, `providers-commit.service.ts:376-407`).
6. Outcome → `drawerCommit` → tab `commitView` — OK (only this tab's own write's outcome shows; "saved" text exists only for `status === 'saved'`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Replace = verify-then-save, nothing persisted on failure | COMPLETE | — |
| anthropic Replace rule (plan :649-652) | COMPLETE | Derivation of "active driver" is over-strict (Finding 2) |
| D15, never "Saved" after a failure or a refused write | COMPLETE | — |
| Delete key, inline confirm, active-driver warning, needs-key after | COMPLETE | Warning misses a not-ready driver (Finding 2c) |
| Copilot sign out; Codex / claude-cli / Ollama copy | COMPLETE | No in-drawer feedback for the login RPCs (Finding 1) |
| Secrets: clear on destroy/save/cancel/switch; mask only; no key in logs/DOM/toasts/errors | COMPLETE | — |
| Concurrency: double-click, overlapping saves, close mid-save, switch mid-edit | COMPLETE | Not pinned by tests (Finding 4) |
| D14: no capability lost | COMPLETE | — |
| Harness: real reaches #7/#8/#12/#49, RUX-1/-4/-10, 64 baseline ids unchanged | COMPLETE | — |
| Specs assert behaviour | COMPLETE | Interleavings untested (Finding 4) |

Implicit requirements not addressed: in-drawer visibility of external sign-in state (Finding 1); a driver notion that survives a not-ready route (Finding 2).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Key edited after a pass | YES | `abandonProbe` on input; Save disabled | — |
| Drawer closed mid-check | YES | `DestroyRef` → `resetReplace` → host cancel | — |
| Drawer closed mid-save | YES | Write continues; page commit block shows the outcome; reopen resets | Not spec-pinned (Finding 4) |
| Another save in flight | YES | `busy()` disables; `run` refuses; fixed refusal copy | — |
| Connection switched mid-edit | YES | id-keyed reset effect; per-instance `pendingWrite` | — |
| Setup read slow/failed | PARTIAL | Custom: Replace absent without endpoint; api-key: Replace offered | Draft tiers become `''` (Finding 5) |
| Verify RPC rejects | YES | Local `unclassified` failure; Save disabled | — |
| Host returns unknown probe reason | YES | `?? 'unclassified'` fallback in the copy table | — |
| `clipboard.writeText` unavailable | YES | Fixed fallback copy | — |
| Non-https `helpUrl` from the registry | YES | Regex gate renders no link | — |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: a user who launches external sign-in from the drawer gets no visible in-drawer feedback while it runs or when it fails, and can re-launch it repeatedly.
- What a robust follow-up would add: an `externalAuth` status input for the tab with in-flight disabling and a fixed failure line (Finding 1); a driver binding that does not depend on route readiness or save state (Finding 2); a rejection guard in `drawerWrite` (Finding 3); specs for the mid-flight interleavings (Finding 4).
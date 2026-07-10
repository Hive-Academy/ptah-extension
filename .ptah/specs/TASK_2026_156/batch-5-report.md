# TASK_2026_156 — Batch 5 Implementation Report (Docs, deferral record, regression sweep)

**Developer**: senior-backend-developer | **Date**: 2026-07-10
**Worktree**: `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang` (branch `fix/gateway-turn-hang`)
**Scope**: plan §9 Batch 5 — M13 (user docs), M14 (lib CLAUDE.md updates), `future-enhancements.md` deferral record, full regression sweep. Zero production TS code touched (docs/markdown only). NOT committed (per instructions).

---

## Per-Item Status

| Item | Status | File(s) |
|---|---|---|
| M13 — gateway user docs (AC-1.5, AC-8.3) | DONE | `apps/ptah-docs/src/content/docs/automation/messaging/discord.md` — new step "6. Register the slash commands" (Gateway tab **Register /ptah** button; upgrade `:::caution` — re-run registration once after upgrade because the bulk-overwrite PUT replaces the old single `/ptah` registration; per-guild instant vs global ~1h propagation, NFR-6/risk-6); new "Threads are sessions" section (thread-per-session product story, US-1); new "Control commands" section: five-command table with where-each-works (read-only in parent channels, mutating thread-only), approved-binding gate, ephemeral-vs-public reply policy (lists/errors ephemeral, one public audit line in-thread on successful mutations, NFR-3), per-command subsections covering exact refusal behaviors (mid-turn, in-use-elsewhere, currently-running, ambiguous pick, deleted-on-disk, no-op keeps session), closed-allowlist semantics (Ptah-known folders only, exact roots, no raw paths, desktop-managed), switch-clears-session (SEC-4/AC-6.4), previous workspace's sessions untouched (AC-6.9), and a `:::note[Discord-only for now]` (AC-8.3 — literal `/sessions` on Telegram/Slack stays a plain prompt, AC-8.4). Matches existing Starlight style (numbered steps, tables, `:::note`/`:::caution[...]` asides — syntax verified against existing pages). |
| M13 — messaging overview page | DONE | `apps/ptah-docs/src/content/docs/automation/messaging/index.md` — new "Sessions & workspaces from chat (Discord-only for now)" section naming the five commands, the closed workspace allowlist, and linking to the Discord page; Telegram/Slack parity noted as a planned follow-up. |
| M14 — messaging-gateway CLAUDE.md | DONE | `libs/backend/messaging-gateway/CLAUDE.md` — Boundaries gain `ConversationStore`, `GatewayCommandService`, `ConversationTurnTracker`, `workspace-resolution.ts`, and the consumer-side ports (`IGatewaySessionLister`, `ISessionActivityProbe` — impls host-registered in `apps/ptah-electron`); Public API updated (command-plane contracts, resolution exports, `setCommandHandler?` on `IMessagingAdapter`, `GatewayConversation.workspaceRoot`); Internal Structure documents `commands/` (control plane never emits `inbound`/touches `MessageStore`), conversation-level `workspace_root` (migration 0028, NULL = inherit) + the transactional writers, `workspace-resolution.ts` fail-closed semantics and the deliberate exact-root/no-subpath divergence, `turn-activity-tracker.ts`, the two host-implemented port files, Discord control-plane boundary (Zod schema, autocomplete, ephemeral defer + public audit line, bulk-overwrite PUT + ~1h global caveat), and the new DI tokens; Guidelines gain the two-plane rule, untrusted-pick/closed-set rule, allowlist-source rule, and the Discord-only note. |
| M14 — gateway-chat-bridge CLAUDE.md | DONE | `libs/backend/gateway-chat-bridge/CLAUDE.md` — Behavior now leads with conversation-first workspace resolution (`resolveEffectiveWorkspaceRoot`, fail-closed on revoked pinned root, per-turn `fs.access` gate, shared with the command service) and the `ConversationTurnTracker` begin/end wiring in `onInbound` (`.finally` on the enqueue promise; watchdog guarantees settlement). Also corrected a stale line: first-turn session persistence is `ConversationStore.setPtahSessionId` (was documented as `BindingStore`) — verified against `gateway-chat-bridge.ts:591-597`; Dependencies list updated to match the Batch-2 package.json back-fill (`agent-sdk`, `agent-generation`, `vscode-lm-tools`). |
| Deferral record (plan M14 file / AC-8.3) | DONE | `.ptah/specs/TASK_2026_156/future-enhancements.md` — 8 deferred items (Telegram `setMyCommands` parity, Slack app-manifest parity, force-attach/steal flag, binding-default mutation from chat, queue-behind-turn alternative, Gateway-tab conversation-workspace display, "Register /ptah" button label rename, pre-metadata sessions not listing) + consciously-excluded list (raw paths/subpaths, prefix parsing, yolo-model changes, ACLs) + the upgrade/registration note carried into docs. |
| Regression sweep | DONE — ALL GREEN | Full outputs below. |

## Regression Sweep (all from the worktree root, final state)

1. **`npx nx run-many -t test --projects=messaging-gateway,gateway-chat-bridge,agent-sdk,persistence-sqlite --skip-nx-cache`** → **NX: Successfully ran target test for 4 projects**
   - agent-sdk: 59 suites passed, **697/697 tests passed**
   - messaging-gateway: 14 passed / 1 skipped suites, **219 passed / 32 skipped** (skips = pre-existing better-sqlite3 native-ABI guard documented since Batch 1: local binary is electron-rebuilt, NODE_MODULE_VERSION 143 vs Node's 137 — native-DB assertions take their built-in skip path, same as on main)
   - persistence-sqlite: 8 passed / 8 skipped suites, **75 passed / 58 skipped** (same native-ABI guard)
   - gateway-chat-bridge: 2 suites passed, **39/39 tests passed** (all TASK_2026_155 specs + Batch-2 specs)
2. **`npx nx affected -t typecheck --base=main`** (the `npm run typecheck:all` equivalent per root package.json) → **NX: Successfully ran target typecheck for 48 projects** — every affected backend lib, frontend lib, and app (incl. ptah-electron, ptah-extension-vscode, ptah-extension-webview, ptah-cli) green. Only pre-existing NG8102 extended-diagnostic warnings in `libs/frontend/chat` (untouched by this task).
3. **`npx nx affected -t lint --base=main`** → **NX: Successfully ran target lint for 50 projects** — **0 errors**; 39 warnings, all pre-existing `@typescript-eslint/explicit-member-accessibility` warnings in `apps/ptah-landing-page` (and none in messaging-gateway, gateway-chat-bridge, persistence-sqlite, agent-sdk, or ptah-electron — verified by grep over the lint log).
4. **`npx nx run ptah-electron:build-main:development`** → **NX: Successfully ran target build-main for project ptah-electron and 20 dependent tasks** (messaging-gateway + gateway-chat-bridge rebuilt fresh; the `import.meta`/cjs esbuild warning from `workspace-intelligence/wasm-bundle-dir.ts` is pre-existing, noted in the Batch-3 report too).
5. **`npx nx build ptah-docs`** → **NX: Successfully ran target build for project ptah-docs** — 142 pages built, Pagefind index OK; both edited pages emitted (`/automation/messaging/index.html`, `/automation/messaging/discord/index.html`). Pre-existing warnings only: unknown `gitignore` code-block language in `workspace/workspace-config.md` and the "Entry docs → 404 was not found" note — both present before this task.

## Decisions Taken

1. **Command docs live on the Discord setup page** (plan M13's named file) rather than a new sidebar entry — the sidebar in `astro.config.mjs` is explicit-items for the messaging section, and the feature is Discord-only; the overview page cross-links to it. No `astro.config.mjs` change needed.
2. **Docs reference the Gateway tab button by its real current label ("Register /ptah")** — the UI still says that (`discord-integration-kit.component.ts:78`) even though it now registers all six commands; renaming the button is UI work outside Batch 5's no-production-code rule and is recorded in `future-enhancements.md` (item 7).
3. **Refusal behaviors in docs paraphrase, not quote, `COMMAND_REPLIES`** — exact strings were verified against `commands/command-replies.ts` so the docs never promise text the bot doesn't say, but paraphrasing keeps docs stable across copy tweaks.
4. **Two stale-fact fixes folded into the bridge CLAUDE.md update** (BindingStore→ConversationStore session persistence; dependency list) — both verified in code, both squarely within M14's "reflect the new internals" mandate.

## Conflicts / Deviations to flag

- None. No blocking findings: the sweep surfaced zero failures attributable to Batches 1–4. The only non-green signals (better-sqlite3 native-ABI test skips, NG8102 warnings, landing-page lint warnings, `import.meta` esbuild warning, docs `gitignore`-language warning) are all pre-existing on main and documented in earlier batch reports or unrelated to this task.
- Process note: the plan's M14 label covers the deferral record; the batch instructions additionally asked for CLAUDE.md updates under M14 — both were delivered.

## Files Modified (4)

- `apps/ptah-docs/src/content/docs/automation/messaging/discord.md` (M13)
- `apps/ptah-docs/src/content/docs/automation/messaging/index.md` (M13)
- `libs/backend/messaging-gateway/CLAUDE.md` (M14)
- `libs/backend/gateway-chat-bridge/CLAUDE.md` (M14)

## Files Created (2)

- `.ptah/specs/TASK_2026_156/future-enhancements.md`
- `.ptah/specs/TASK_2026_156/batch-5-report.md` (this report)

## Remaining before merge (outside Batch 5's mandate)

- Manual Discord smoke pass (DoD #2) — scripted checklist is in plan §8: fresh thread → `/sessions` → `/session use` → context continues; `/new` → fresh; `/workspace list` → `/workspace use` → next turn in picked root; migration applies on an existing `~/.ptah/ptah.db`.
- Commit + PR (explicitly excluded from all batch instructions).

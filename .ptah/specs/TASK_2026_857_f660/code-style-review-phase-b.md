# Code Style Review - Phase B (B13-B19, B21), TASK_2026_857_f660

Scope: commits e60d665c3, 7402fb558, aab77cbea, 15a10bc5f, 0189199e6, 20dffd75e, 5c062d374, 6a7429833, reviewed at HEAD. Read in full: scope/*, lane-routing DI + barrel, host-routing coordinator header/constructor/lifecycle, register-host-routing.ts, the chat-session admission hunk, agent-sdk queue wiring and hook-handler hunk, vscode-lm-tools route hunks, electron phase-2/phase-4 and census files. Ran `prettier --check` (read-only) on the touched .ts files.

## Verdict

REVISE, 7/10. Boundaries, token naming and typing are clean: no `any`, `as unknown as`, `@ts-ignore`, `eslint-disable` or `console.*` in new production code; all `Symbol.for` tokens sit in the lib `di/tokens.ts`; `registerHostRouting` is composed only from the Electron phase files; `rpc-handlers` already depended on `vscode-lm-tools`, `agent-sdk` and `lane-routing`, so there are no new lib-to-lib edges. Two things hold it back: a process-lifecycle listener added inside a DI phase against the repo's own teardown convention (finding 1), and the Phase A "new code is not in repo format" item recurring in five production files (finding 2). Both are small fixes.

## Review family

Mixed. B13-B17 and B21 were written by non-Claude lanes (codex); B18/B19 by Claude. I am Claude, so evidence for B18/B19 (coordinator, `register-host-routing.ts`, `chat-session.service.ts` hunk) is labelled "same-family, weaker". Findings 1 and 2 concern lane-written code; finding 6 is same-family, weaker.

## Findings

1. **Serious (REVISE) - process-lifecycle listener registered inside DI phase 4.**
   `apps/ptah-electron/src/di/phase-4-handlers.ts:97-104` (plus new `import { app } from 'electron'` at line 16) registers `app.once('will-quit', ...)` that does `container.resolve(CHAT_TOKENS.HOST_ROUTING_COORDINATOR).dispose()`. The repo's teardown convention is the `main.ts` `will-quit` chain (`main.ts:416`) over instances captured eagerly in `BootState` (`activation/boot-coordinator.ts:116-121`: "resolved eagerly ... instead of forcing a first-time lazy build of its dependency graph mid-teardown"). This hook does the opposite: a lazy `resolve` at quit. If the coordinator was never resolved it is constructed during teardown, and subscribes to adapter events just to dispose them. The `typeof app?.once === 'function'` guard exists only for the smoke spec, so test shape leaks into production. It also makes a DI phase own an Electron lifecycle side effect, which no sibling phase does.
   Fix: capture the coordinator in `BootState` the way `cliRegistry` is (resolved in the boot-heavy-services path) and dispose it in the existing `main.ts` will-quit chain; drop the `electron` import and guard from phase 4.

2. **Serious (REVISE) - new production code not in repo format (Phase A finding 2 recurring).**
   `prettier --check` fails on `agent-sdk/src/lib/helpers/next-turn-reminder.queue.ts:29,55-67` (single-line `set({...})` and multi-line destructure), `agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.ts` (`reminder = this.nextTurnReminderQueue?.take(...)` and the `[pointer, reminder].filter(Boolean).join(...)` line exceed 80 cols; this file was clean before B16), `lane-routing/src/lib/route-decide.service.ts` (clean before B14), `lane-routing/src/lib/scope/preflight-reuse-cache.ts`, `scope/scope-check.service.ts` (the `sections(fields: ...)` signature), plus six spec files. Cost: the next person to touch these runs a formatter and gets a noisy diff; lint-staged should have caught this, so the commits bypassed or skipped it.
   Fix: `npx prettier --write` on exactly these files, one fixup commit.

3. **Moderate - the `{ readonly sessionKey?: string }` context type is spelled inline in three places.**
   `lane-routing/src/lib/route-decide.service.ts:117`, `vscode-lm-tools/.../route-tool-handlers.ts:112`, `vscode-lm-tools/.../route-namespace.builder.ts:46`. It is now part of the public `decide(args, context?)` shape on `RouteAgent`/`RouteDecideService`. Adding a second context field later means three coordinated edits across two libs, and a typo in one silently drops the key. `route-tool-handlers.ts:112-114` also branches `context ? decide(a, context) : decide(a)` to avoid passing `undefined`, which a named optional parameter does not need.
   Fix: export `type RouteDecideContext = { readonly sessionKey?: string }` once from lane-routing (barrel) and use it in all three; always call `decide(parsed.data, context)`.

4. **Moderate - cap constants duplicated across libs with no link.**
   `host-routing.coordinator.ts:63-67` (`TURN_TEXT_CAP 2000`, `PREVIOUS_TURN_CAP 800`, `ASSISTANT_REPLY_CAP 1500`, `ROUTED_SCOPE_CAP 1200`, `MAX_TABS 200`) repeat the slice caps hard-coded in `lane-routing/src/lib/scope/scope-check.service.ts` (`scopeRequest`, `buildPreflightScopeSummary`: 1200/800/1500/2000) and `next-turn-reminder.queue.ts` (200 entries). The coordinator already notes one such copy in a comment (line 68, "not on its barrel"). If scope-check changes a cap, the coordinator silently truncates differently.
   Fix: export the scope caps from the scope-check module (barrel) and import them; leave `MAX_TABS`/queue size as separate, named policies.

5. **Minor - file naming deviates from the dotted-role convention of the sibling directories.**
   `lane-routing/src/lib/scope/host-routing-setting.ts` and `preflight-reuse-cache.ts` have no role suffix, while neighbours use `rotation.store.ts`, `capability-matrix.store.ts`, `decision-model.config.ts`, and the same folder's `scope-check.service.ts`. Suggest `host-routing.setting.ts` and `preflight-reuse.cache.ts`. Cheap now, a churn-y rename after other libs import by path in specs.

6. **Minor (same-family, weaker) - prettier-only reformatting mixed into the B19 feature commit.**
   `rpc-handlers/.../chat-session.service.ts` diff is +158/-37, of which roughly 100 lines are reflow of untouched methods (`startAgentChildSession`, `gateAccount`, resume result type). The real change is a ~25-line `admitHostRoutingTurn` plus four call sites, which is the right minimal growth for a 2058-line god file, but the noise hides it in blame and review. Same pattern in the lane-written B15 (`protocol-dispatcher.ts` import reflow) and B21 (`phase-2-libraries.ts`, `expected-resolvable.ts`). Not worth reverting; note for future batches to format in a separate commit.

7. **Minor - duplicate import specifier in a census file.**
   `apps/ptah-electron/src/di/expected-resolvable.ts:14` adds a second `import { CHAT_TOKENS } from '@ptah-extension/rpc-handlers'` right under the existing import from the same module. Merge into the first import.

8. **Minor - barrel exports concrete classes used only as types.**
   `lane-routing/src/index.ts:72-80` (`HostRoutingSetting`, `PreflightReuseCache`, `ScopeCheckService`) and `agent-sdk/src/index.ts` (`NextTurnReminderQueue`) are value exports, but their only consumer (`host-routing.coordinator.ts:30-51`) imports them with `type`. This matches how `RouteDecideService` is already exported, so it is consistent rather than wrong; `export type` would stop other libs constructing them directly. Surface is otherwise minimal and needed (`BUILTIN_SUBAGENT_ROLES`, `buildPreflightScopeSummary`, `buildRouteCandidateSource`, `registerHostRouting`, `HostRoutingCoordinator` + `AdmitUserTurnInput` are all consumed).

## Checked and clean

- Tokens: `SCOPE_CHECK_SERVICE`, `HOST_ROUTING_SETTING`, `PREFLIGHT_REUSE_CACHE` (lane-routing), `SDK_NEXT_TURN_REMINDER_QUEUE` (agent-sdk), `HOST_ROUTING_COORDINATOR` (rpc-handlers chat tokens) use `Symbol.for` with descriptive names in the existing token objects.
- `register.ts` factories use `instanceCachingFactory` like the Phase A entries; `registerHostRouting` precondition check mirrors `registerChatServices`; Electron-only binding is documented and the optional `@inject(..., { isOptional: true })` in `ChatSessionService` matches the opt-in design.
- `expected-resolvable.ts`/smoke spec updated for the new surface, as the DI-phase rule requires.
- Logging: injected `Logger`, errors logged by class name only, `degradation-audit:` comments present on new catches (`chat-session.service.ts` `admitHostRoutingTurn`, hook handler reminder drain).
- File sizes: new files 24-165 lines except `host-routing.coordinator.ts` (620, one responsibility, state machine with documented guards; acceptable).
- Closed Phase A items not repeated: classifier degradation-audit comment was added in B14 as agreed.

## Defer candidates

- Finding 4 (shared cap constants), finding 5 (rename), finding 6 (format-only commits), finding 7, finding 8 are safe to defer to a cleanup batch.
- Splitting `coordinator.ts` (candidate-label listing and tab LRU helper) only if a third use appears; no change now.

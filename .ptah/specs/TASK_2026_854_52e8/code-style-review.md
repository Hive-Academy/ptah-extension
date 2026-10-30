# Code Style Review — `TASK_2026_854_52e8`

Worktree: `.claude-worktrees/feat-session-auto-links-6e9899b8a83f` (uncommitted vs `main`). Paths below are relative to it.

## Summary

| Metric          | Value         |
| --------------- | ------------- |
| Overall score   | 7.5/10        |
| Assessment      | APPROVED (with follow-ups) |
| Blocking issues | 0             |
| Serious issues  | 2             |
| Minor issues    | 5             |
| Files reviewed  | ~30 production files read or diffed (backend session-organization, agent-sdk hooks, persistence-sqlite 0063, shared task-id, rpc-handlers, chat/chat-ui/tasks-ui); ~45 spec/fixture files only grepped |

Scope examined: git status and diff stat, the DI files (`tokens.ts`, `register.ts`, `start.ts`), `index.ts` barrels, the migration, the new side-table port/store, the auto-link and todo services (headers, imports, constructors), the frontend cache store and compact card diff. Checks: grep of the whole diff and untracked files for `as any`, `as unknown as`, `@ts-ignore`, `eslint-disable`, `console.`, `: any`; scoped `npm run verify -- -t lint -p session-organization` (cache hit, passed). I did not read every line of the 689-line auto-link service or the store's new transactional body, so the file-by-file scores for those two rest on structure and imports, not a line audit. Runtime behaviour belongs to code-logic-review.

## Five style questions

### 1. What breaks in six months?

- The main store now carries side-table orchestration through an optional collaborator: `this.sideTables?.…` is called in at least five places (suppress, deleteSession, rekey, todo upsert, list). A mistake in registration (`SIDE_TABLES` unresolved) degrades silently to "no suppression, no todos" because the param is `{ isOptional: true }` (store diff, `@inject(SESSION_ORGANIZATION_TOKENS.SIDE_TABLES, { isOptional: true })`). `register.ts:48-56` binds it unconditionally, so optionality only serves unit tests; production can never lose it, yet the code cannot tell the two apart.
- `session-organization.store.ts` is 1157 lines (906 code lines by my count, was 875 total) and `session-organization.service.ts` 992 (was 949). Both exceed the repository's `max-lines` 700 tripwire (`eslint.config.mjs:~570`, `skipComments`, `skipBlankLines`). The next feature lands in files already past the ceiling.
- The auto-link service (`session-auto-link.service.ts`, 689 lines / 566 code) subscribes to four unrelated event sources (prompt, expansion, session-id-resolved, organization change, task index). A fifth rule (R8) will add a fifth trigger to the same class.

### 2. What would a new team member misread?

- `SIDE_TABLES` and `AUTO_LINK_STORE` are two tokens for one singleton (`di/tokens.ts`, `register.ts:50-55`). The comment explains it, but a reader will wonder which to inject. The main store uses the port token, the services use the concrete one; that is a correct split, but only the doc comment records it.
- Doc comments cite review-round ids (`RR1-2`, `RR1-3`, `RR1-6`, `RR1-8`, `D4`) from `decisions.md` in many production headers (`session-organization-side-tables.ts:2-3`, `session-auto-link.service.ts` header, `task-id.schema.ts:2`). Anyone without that spec folder cannot decode them; the rationale text next to them mostly stands alone, so this is minor.
- `Pick<…>` aliases (`AutoLinkOrganizationService`, `AutoLinkOrganizationStore`, …, `session-auto-link.service.ts:~80-110`) are exported from the lib barrel (`index.ts` auto-link block). They look like ports but are structural views over concrete classes; the capture service already does this (`SessionOrganizationPostToolUseSource`), so it is consistent, but exporting eight of them widens the public surface for test seams only.

### 3. What does this cost to maintain?

- One more migration plus three tables to keep in sync with `rekey` and `delete` SQL, handled by the participant port (`session-organization-side-tables.ts`), which is the cheapest correct shape given the transaction requirement.
- The `src/testing/sqlite-test-db.ts` harness hard-codes "migrations 1..50 and 0063" (header comment). Any later migration that alters `session_task_links` needs this list revisited; it should derive from `MIGRATIONS` filtered by dependency, or use the full list.
- 30 migration specs were touched for the version bump (`0028…0062_*.spec.ts`). That churn is a recurring cost of the existing "latest version" assertion pattern, not a defect of this change.

### 4. Where is this inconsistent with the rest of the repository?

- Mostly it is not. Hook fan-out follows the existing `CallbackRegistryBase` pattern and adds `agentIdField` to the shared base file (`callback-registry.base.ts:55-65`) instead of copying it into three handlers. Migration 0063 follows 0050/0055/0060-0062 conventions (static SQL, bare ALTER, no CHECK) as its header states. `start.ts` generalises capture-only start into a `PARTS` list with reverse-order dispose, which fits the existing `report`/`describe` helpers.
- Two inconsistencies: (a) `TASK_ID_PATTERN` is imported from `@ptah-extension/shared/schemas` (`session-auto-link.service.ts:~52`) while the same lib imports other shared types from `@ptah-extension/shared`; the secondary entry is mapped in `tsconfig.base.json:233`, so it is legal, but it needs a stated reason (zod-bearing runtime values vs types). (b) `libs/backend/session-organization` now depends on `@ptah-extension/task-specs` (both `scope:extension`/`type:feature`, no cycle: nothing in `task-specs/src` imports session-organization). The dependency is token-only and optional, which is the right shape, but `README`/`CLAUDE.md` for the lib was not updated to say so (not checked; the lib has no CLAUDE.md in its listing).

### 5. What would I have done differently?

- Move the new store orchestration (suppress/rekey/delete/todo hooks) out of `session-organization.store.ts` into the side-table participant or a small `*-reconcile.ts` unit, so the main store stays near its previous size. The participant port already exists; `applyAutoLinkPlan` and the todo upsert path could live behind it.
- Make `SIDE_TABLES` required in the store and let specs provide a fake. That removes the six `?.` branches and the silent-degradation case.
- Split `SessionAutoLinkService` by trigger: an evidence/reconcile core plus thin subscribers (prompt queue, resolve queue, index watcher). Better because each queue has its own bound and replay rules (`MAX_QUEUED_PROMPTS`, `MAX_PENDING_RESOLVES`, `MAX_EXISTENCE_CACHE`) which are currently interleaved in one class.

## Blocking issues

None. No `eslint-disable` of `@nx/enforce-module-boundaries`; no deep relative import into another lib; no adapter import from an agnostic lib (session-organization imports `platform-core`, `persistence-sqlite`, `agent-sdk`, `task-specs`, `shared` through their barrels only, as `session-auto-link.service.ts:32-52` shows).

## Serious issues

### Store and service grew past the file-size tripwire

- File: `libs/backend/session-organization/src/lib/session-organization.store.ts` (1157 lines; +282), `session-organization.service.ts` (992; +43), `session-auto-link.service.ts` (689).
- Problem: store (906 code lines) and service (747) exceed `max-lines` 700 with comments and blanks skipped, and the repo asks for facades rather than growth past the ceiling. The store gained todo, suppression, worktree-peer and auto-link-plan responsibilities beyond "organization persistence".
- Tradeoff: splitting by responsibility (auto-link plan application, todo progress persistence) keeps the main store transactional core small; the participant port from this very change is the natural seam. Leaving it costs a larger diff surface for every later change and a lint warning that is already visible.
- Recommendation: extract `applyAutoLinkPlan` / `listWorktreePeers` and the todo accessors into the side-tables unit or a sibling, keep the main store as facade. Not required to merge (the rule is `warn`), but do before the next feature touches these files.

### Optional injection of a dependency that is always registered

- File: `libs/backend/session-organization/src/lib/session-organization.store.ts` (constructor, `sideTables?`), `di/register.ts:48-56`.
- Problem: `SIDE_TABLES` is bound unconditionally in the only registration path, yet the store treats it as optional and guards every use with `?.` / early return (`if (!sideTables) return false;` in the todo upsert). This is test accommodation leaking into production control flow, and it hides a wiring regression as "feature silently off".
- Tradeoff: required injection fails loudly at resolve time, which the DI guard specs (`container.smoke.spec.ts` in cli/electron, `session-organization-unavailable.spec.ts` in vscode) would catch.
- Recommendation: make it required and update the store specs to pass a fake; keep `isOptional` only for `TASK_INDEX_SERVICE`, which is genuinely absent in some hosts.

## Minor issues

- `libs/backend/session-organization/src/testing/sqlite-test-db.ts:135` returns `connection as unknown as SqliteConnectionService`. It is test-only and excluded from the lib build (`tsconfig.lib.json` exclude), but a typed adapter or a `// reason` comment would meet the "no `as unknown as`" rule.
- `libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.spec.ts` and `user-prompt-submit-hook-handler.spec.ts` (added lines ~134-135 of the diff): `as unknown as HookInput` in specs; add a typed fixture builder as the sibling specs do, or accept as test-only.
- `libs/backend/session-organization/tsconfig.lib.json`: excluding `src/testing/**/*` is correct, but a `tsconfig.spec.json` include check was not verified; confirm the harness is type-checked by the spec project.
- `libs/frontend/chat/src/lib/services/session-organization/session-organization-cache.store.ts:20`: `const UNKNOWN: Signal<…> = signal(null).asReadonly();` on one line exceeds the Prettier width, formatter owns it; ignore if `lint-staged` rewrites it. The file is a `providedIn: 'root'` `@Injectable` with `inject()` and signals and uses `LoggingService`, matching sibling stores, so no Angular convention finding.
- `libs/shared/src/schemas.ts:24` re-exports `task-id.schema` via `export *`, matching neighbours; the file `task-id.schema.ts` is not named with the plural `.schemas.ts` used by siblings (`task-view.schemas`, `branded.schemas`). Naming drift, no runtime cost.

## File-by-file

### `libs/backend/session-organization/src/lib/di/tokens.ts`, `register.ts`, `start.ts`

Score 9/10 — 0B 0S 1M. Tokens are `Symbol.for` in the existing grouped object; registration order is documented (side tables before store) and the header pre/post-conditions were updated (`register.ts:1-31`). `start.ts` iterates a `PARTS` list, skips unregistered parts with `isRegistered(token, true)` and disposes in reverse; spec coverage updated (`start.spec.ts`, `register.spec.ts`). The only wart is the dual token noted above.

### `libs/backend/session-organization/src/lib/session-organization-side-tables.ts`

Score 9/10 — 0B 0S 0M. A narrow transaction-participant port with explicit "caller owns the transaction" contract (lines 1-10). Good placement: the main store depends on this abstraction, not on `SessionAutoLinkStore`.

### `libs/backend/session-organization/src/lib/session-auto-link.store.ts` (221)

Score 8/10 — 0B 0S 0M. Injects `PERSISTENCE_TOKENS.SQLITE_CONNECTION`, implements the port, SQL is parameterised statements per the file header; size is fine.

### `libs/backend/session-organization/src/lib/session-auto-link.service.ts` (689)

Score 7/10 — 0B 1S 1M. Constructor injection with tokens only (`:149-167`), the task index is `isOptional`, all dependencies are narrowed with `Pick`, no timers, bounded queues. Responsibility spread is the concern (Q5). Logging goes through `IOutputChannel` with a `[SessionOrganization]` prefix and no prompt text, consistent with the capture service; no `console`.

### `libs/backend/session-organization/src/lib/auto-link/task-link-rules.ts`, `git-worktree-info.ts`

Score 9/10 — 0B 0S 0M. Pure functions under an `auto-link/` folder, filesystem read via `IFileSystemProvider` (not `fs`) so it stays runtime-agnostic. Good split from the service.

### `libs/backend/session-organization/src/lib/session-organization.store.ts` (1157), `session-organization.service.ts` (992)

Score 6/10 — 0B 2S 0M. Behaviour is coherent, but both files are well past the tripwire and the optional `sideTables?` pattern spreads through the store.

### `libs/backend/session-organization/src/lib/session-todo-progress.service.ts` (124)

Score 8.5/10 — 0B 0S 0M. Small single-purpose subscriber; zod validates the TodoWrite payload at the boundary (`:16`); registered and started like the capture service.

### `libs/backend/persistence-sqlite/src/lib/migrations/0063_session_auto_links.ts`, `index.ts`

Score 9/10 — 0B 0S 0M. Follows the migration conventions and appends version 63 at `index.ts:448-452`. The header cites the CHECK-free decision and the static-SQL rule.

### `libs/backend/agent-sdk/src/lib/helpers/*` (callback registries, hook handlers)

Score 8.5/10 — 0B 0S 1M. `agentIdField` shared in `callback-registry.base.ts:55-65`, optional `agentId` added to payloads without breaking existing shapes. Spec casts noted under Minor.

### `libs/shared/src/lib/types/task-id.schema.ts`, `session-organization.types.ts`, `rpc/rpc-session.types.ts`

Score 8.5/10 — 0B 0S 1M. One grammar for task ids, with the length cap before the regex; `SessionLinkTaskParams.source` narrowed to `Extract<…, 'user' | 'board-start'>` so auto sources are not webview-claimable at the type level. The new field `todos` extends the existing typed RPC file; `rpc-session.types.ts` is a domain file (not the oversized `rpc.types.ts`), so the "split by domain" rule is respected.

### `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.handlers.ts`

Score 8.5/10 — 0B 0S 0M. `groupByTask` callback widened to `Pick<TaskLinkedSession,'prLinks'|'todos'>`, copying objects so store state is not leaked.

### `libs/frontend/chat/src/lib/services/session-organization/session-organization-cache.store.ts`; `compact-session-card.component.ts`; chat-ui `compact-session-metrics.ts`, `compact-rail-card`, `compact-session-activity`

Score 8.5/10 — 0B 0S 0M. Standalone-compatible patterns: `inject()`, signals, `computed` with explicit `equal`, `LoggingService`, no timer (header says "No timer runs"), LRU bounded at 64. New chat-ui helpers are exported through the lib barrel (`chat-ui/src/index.ts`), and `chat` consumes them via `@ptah-extension/chat-ui`. Removal of `board-task-link-capture.service` leaves no dangling references (grep over `libs` and `apps` returned none) and `chat/services/index.ts` exports the replacement.

### `libs/frontend/tasks-ui/...` (`task-card`, `task-detail`, `task-session-links.service`)

Score 8/10 — 0B 0S 0M. `SESSION_SOURCE_LABELS: Record<SessionTaskLinkSource, string>` (`task-detail.component.ts:79`) is exhaustive, so the new sources are compile-checked.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| New cross-lib imports use barrel / mapped entry only | PASS | `session-auto-link.service.ts:32-52`; `tsconfig.base.json:186,233` |
| No `eslint-disable` of module boundaries | PASS | grep of diff and untracked: none |
| Project tags (`scope:*`, `type:*`) on touched libs; no new project | PASS | `session-organization/project.json:6`, `task-specs/project.json:6` |
| Hexagonal: agnostic lib depends on platform-core ports, not adapters | PASS | `session-auto-link.service.ts:32-40` (`IFileSystemProvider`, `IOutputChannel`) |
| No new `vscode-core` import from an agnostic lib | PASS | imports listed above |
| Tokens are `Symbol.for` in a grouped object | PASS | `di/tokens.ts` (`AUTO_LINK_STORE`, `SIDE_TABLES`) |
| Filenames kebab-case with role suffix | PASS | `session-auto-link.service.ts`, `session-auto-link.store.ts`, `session-organization-side-tables.ts` |
| Ports `I*`-prefixed, exported with `export type` | FAIL (minor) | `SessionOrganizationSideTables` has no `I` prefix; it follows the lib's own `SessionOrganizationPostToolUseSource` style rather than `platform-core` |
| DI guard specs updated for new resolvable surface | PASS | `apps/ptah-cli` and `apps/ptah-electron` `container.smoke.spec.ts`, vscode `session-organization-unavailable.spec.ts` are in the diff; VS Code `expected-resolvable.ts` / `expected-absent.ts` do not mention session-organization tokens (grep: none), so no update is due |
| VS Code DI phase files | NOT_APPLICABLE | No phase file in the diff; registration stays in the lib's helper |
| Webview-to-host messages through the typed contract | PASS | `rpc-session.types.ts` extended in place |
| No `as any` / `@ts-ignore` / implicit `any` in production code | PASS | grep clean over production files |
| No `as unknown as` | FAIL (minor, test-only) | `src/testing/sqlite-test-db.ts:135`; two in hook-handler specs |
| Logger, not `console` | PASS | no `console.` in production; `IOutputChannel` / `LoggingService` used |
| Angular `inject()`, signals, `providedIn: 'root'` | PASS | `session-organization-cache.store.ts:49-53` |
| File-size ceiling 700 (warn) | FAIL (serious) | store 1157/906 code lines, service 992/747, per Serious issue 1 |
| Migration conventions (static SQL, bare ALTER, no CHECK) | PASS | `0063_session_auto_links.ts` header and body |
| Commit scopes in `.commitlintrc.json` | NOT_APPLICABLE | No commit yet; use scopes for `session-organization`, `agent-sdk`, `chat`, `persistence-sqlite` only if present in the enum |

## Maintenance debt

- Introduced: three side tables and one migration; two services and a store; a two-token DI alias; an optional-collaborator pattern in the main store; larger store and service files.
- Retired: `board-task-link-capture.service` (+spec) and its wiring in `chat-message-handler` and `task-prompt-bridge`, replaced by host-side rules; duplicated `agentId` handling in the hook layer via one helper.
- Net: neutral to slightly positive for behaviour (one authority, host-side), slightly negative for file size in the two central session-organization files.

## Verdict

- Recommendation: APPROVE (follow-ups tracked)
- Confidence: MEDIUM (boundaries, wiring and conventions checked by grep and targeted reads; the bodies of the 689-line service and the store's new transaction code were not line-audited)
- Key concern: the main store and service are well over the 700-line tripwire and the store treats an always-registered side-table port as optional.
- What a 10/10 version would do differently:
  - Make `SIDE_TABLES` a required injection in the store and move auto-link plan application and todo accessors out of the main store so it stays near its previous size.
  - Split `SessionAutoLinkService` into a reconcile core and per-trigger subscribers with their own bounded queues.
  - Replace the `as unknown as` casts in test helpers with typed builders.
  - Drop review-round ids (`RR1-x`, `D4`) from production comments in favour of the rationale alone.
  - Record the new `task-specs` dependency and the `shared/schemas` choice in the lib's docs.

VERDICT: APPROVED

# Code Logic Review — TASK_2026_580_9f77 (Batch A3.2, Revision 1)

Narrow re-check of Batch A3.2 (`SessionOrganizationService`, PR URL parser `parsePrUrl`, and DI tokens `SESSION_ORGANIZATION_TOKENS`) following the round 1 review (`code-logic-review-A3.2.md`).

---

## Defect 1: `parsePrUrl` Non-String Input Handling — RESOLVED

- **Implementation**:
  - In [pr-url.ts:45-47](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/utils/pr-url.ts#L45-L47), `parsePrUrl(raw: unknown)` adds an explicit type guard `if (typeof raw !== 'string') return null;` before calling `raw.trim()`. Non-string inputs (`undefined`, `null`, numbers, objects) immediately return `null` without throwing.
  - In [session-organization.service.ts:461-466, 492-497](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L461-L466), `addSessionPrLink` and `removeSessionPrLink` receive `null` from `parsePrUrl` when `url` is non-string or undefined. `requireValid` then cleanly throws `SessionOrganizationInputError` (`'url must be an https URL of at most 2048 characters'`). `TypeError` cannot escape.
- **Specification**:
  - [pr-url.spec.ts:80-90](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/utils/pr-url.spec.ts#L80-L90) tests `undefined`, `null`, numbers, and objects, asserting that `parsePrUrl` does not throw and returns `null`.
  - [session-organization.service.spec.ts:580-600](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.spec.ts#L580-L600) verifies that `addSessionPrLink` and `removeSessionPrLink` reject with `SessionOrganizationInputError` on `undefined`, `null`, numbers, and objects without touching the store.

---

## Defect 2: Synchronous Guard on All Five Recorder Methods — RESOLVED

- **Implementation**:
  - All five recorder methods in `SessionOrganizationService` now delegate through `guarded(call, input, body)`:
    - `recordWorktree`: [session-organization.service.ts:197-201](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L197-L201)
    - `recordLineage`: [session-organization.service.ts:224-226](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L224-L226)
    - `linkTask`: [session-organization.service.ts:264-266](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L264-L266)
    - `addPrLink`: [session-organization.service.ts:300-302](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L300-L302)
    - `recordAgentStartedSession`: [session-organization.service.ts:342-348](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L342-L348)
  - `guarded` ([session-organization.service.ts:604-614](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L604-L614)):
    - If `typeof input !== 'object' || input === null`, it logs `${call} dropped: input is not an object` and returns immediately.
    - If `body()` executes and encounters an unexpected throw (e.g. an object property getter throwing an exception), it is caught by `try/catch` and logged as `${call} dropped: ${describe(error)}`.
    - If `input` is `{}` or has missing/wrong-type fields, the inner validation helper detects `invalid !== null`, and `this.capture` logs `${call} dropped: ${invalid}` and returns.
  - The detached asynchronous pipeline in `runCapture` ([session-organization.service.ts:630-660](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L630-L660)) remains enclosed in an all-encompassing `try { ... } catch (error: unknown) { this.log(...) }` block. Because `runCapture` never throws or rejects, `void this.runCapture(...)` cannot produce an unhandled promise rejection under any condition.
- **Specification**:
  - [session-organization.service.spec.ts:542-578](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.spec.ts#L542-L578) tests all 5 recorder methods against `undefined`, `null`, and `{}` (15 cases). Every case asserts `not.toThrow()`, no store call, no metadata read, and exactly one log line matching `[SessionOrganization] <method> dropped: `.

---

## Defect 3: `invalidOptionalId` for Parent and Fork Session IDs — RESOLVED

- **Implementation**:
  - `invalidOptionalId(value: unknown, field: string)` is defined at [session-organization.service.ts:788-790](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L788-L790), returning `null` when `value === undefined` and delegating to `invalidId(value, field)` otherwise.
  - Used for `parentSessionId` and `forkOfSessionId` in `recordLineage`: [session-organization.service.ts:231-232](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L231-L232).
  - Used for `parentSessionId` in `recordAgentStartedSession`: [session-organization.service.ts:358](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L358).
  - Multi-line session IDs and session IDs exceeding 256 characters in `parentSessionId` and `forkOfSessionId` are now rejected synchronously during initial validation before reading metadata.
- **Specification**:
  - [session-organization.service.spec.ts:448-469](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.spec.ts#L448-L469) adds 3 new table rows covering multi-line `parentSessionId`, oversized `forkOfSessionId`, and multi-line `parentSessionId` on `recordAgentStartedSession`, asserting they drop cleanly without store calls or metadata reads.

---

## Regression & Hygiene Verification

- **Valid write paths**: Valid recorder calls (`recordWorktree`, `recordLineage`, `linkTask`, `addPrLink`, `recordAgentStartedSession`) pass through `guarded`, pass inner field validation, resolve roots via metadata with D3 precedence, and perform their respective store writes and change emissions unimpeded.
- **No duplicate logging**: Non-object inputs exit in `guarded` without invoking `body()`. Validation failures in `body()` exit in `capture` without throwing out to `guarded`. Exactly one log line is emitted on any drop.
- **No new findings**: No Blocker, Major, or Moderate issues introduced.

---

## Verdict

- Recommendation: APPROVED
- Confidence: HIGH

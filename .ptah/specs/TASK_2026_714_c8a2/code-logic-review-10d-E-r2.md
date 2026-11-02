# Code Logic Review — Batch 10d.E revision 2 (TASK_2026_714_c8a2)

Review family: claude
Implementer family: codex

Score: 8/10

VERDICT: APPROVED

Scope examined: `git diff` of all 14 modified files, the untracked `codex-lane-composition.spec.ts`
(read `:1-290`), file modification times against the r1 review (16:49). After r1, only these files
changed: `codex-app-server-lane.adapter.ts`, `codex-app-server-lane.adapter.spec.ts`,
`session-metadata-store.spec.ts` and `codex-lane-composition.spec.ts`. This matches the revision 2
scope. `codex-lane-composition.ts` did not change (16:43). Also read: the mock
`listForWorkspace` (`platform-core/src/testing/mocks/session-record-repository.mock.ts:60-70`) and
`SessionMetadataStore.getForWorkspace` (`session-metadata-store.ts:1570-1592`).
No checks were run (read-only review by instruction). The coordinator must still run the specs.

Why 8 and not 9: the R3 case mocks `CodexRuntime.prototype.open`, so it cannot detect one shared
runtime instance across chat and lane (observation O1). The specs are not yet run. Why not 7: all
three r1 defects are fixed, each fix can fail on the bug it targets, and no new regression is in
the diff.

## r1 new defects 1-3

| # | Status | Evidence |
| --- | --- | --- |
| 1 parseOutput deletes newlines (major) | fixed | `codex-app-server-lane.adapter.ts:184` is `/\r(?!\n)/g` again. The line is no longer in `git diff`, so it equals HEAD. Spec `codex-app-server-lane.adapter.spec.ts:186-190`: `'line 1\nline 2\r\n'` is unchanged, `'a\rb'` becomes `'ab'`. The first assertion fails on the r1 regex (it would remove both `\n`), the second fails on a no-op. |
| 2 R3 case tautological (minor) | fixed | `codex-lane-composition.spec.ts:59-72`: the fake context keeps the real profile that the composition gives to `open`, and `turnPermissionLevel` reads from that profile. `:199-212`: after each open, `structuredClone` stores a deep copy of profile, fingerprint, permission, sandbox and approval policy. Then all earlier live contexts are compared with their own copies. A later open that mutates an earlier profile fails `:211`. One profile object reused across scopes fails `:262` (`Set` size 4). Both directions: `:190`, `:236-238` (chat-first, lane-first), with a second chat on other home, other workspace and `plan` (`:244-245`), and a second lane on other workspace (`:251`). `:259-270` prove the order, the consumer per open, and the policy values (`plan` → `read-only`, lane `never`). |
| 3 lane-row exclusion only on legacy path (minor) | fixed | `session-metadata-store.spec.ts:379-410` builds `SessionMetadataStore` with `createMockSessionRecordRepository`. It proves `isChild` true on the record (`:394`), lane read works (`:396`), chat read is empty (`:397-398`), both listing modes are empty (`:399-400`), the records branch ran (`:401`), and chat resume lookup is empty (`:403-409`). `getForWorkspace(W, true)` includes child rows in the mock (`session-record-repository.mock.ts:60-70`), so `:400` proves the consumer filter at `session-metadata-store.ts:1579-1580` and not only `isChild`. |

## Defects 1-7 of the first review

All stay as r1 recorded them. The production files for defects 2-7 have the same modification
time as at r1 (`codex-lane-composition.ts`, `session-metadata-store.ts`,
`codex-thread-identity-store.ts`, `session-runtime-identity-cache.ts`, `cli-detection.service.ts`,
`phase-2-libraries.ts`, `codex-runtime-composition.ts`). Defect 1 (partial at r1 because of case
(b)) is now fixed by r1 defect 2 above.

Extra checks:

- Chat rows without the marker keep their behaviour: absent `consumer` maps to `chat` at
  `codex-thread-identity-store.ts:59,99,140`. The listing filter compares only with `'lane'`
  (`session-metadata-store.ts:1580,1588`).
- D27: the single lane routing helper stays at `codex-lane-composition.ts:245`. The chat-only
  native capability check is `codex-runtime-composition.ts` (`consumer === 'chat' && ...`), so
  `PTAH_CODEX_RUNTIME_DEV` does not open lanes.

## New defects

None with a behavioural impact.

Observation O1 (info, not blocking): `codex-lane-composition.spec.ts:194` mocks
`CodexRuntime.prototype.open`. Thus the case cannot detect a bug where lane and chat resolve the
same `CodexRuntime` instance. To close this, record `this` in the mock and assert that the chat
and lane opens use different instances. Production code resolves the lane runtime from its own
scope (`codex-lane-composition.ts:245`), so no defect is present now.

## Five logic questions

1. Silent failure: none found. Lane output keeps line breaks again.
2. User action: a user reads multi-line lane output through `ptah_agent_read`. Lines are kept.
3. Wrong answer: none found in routing, identity, listing or resume.
4. Dependency failure: unchanged from r1 (failed open disposes the scope, empty home reports once).
5. Missing from requirements: none new.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Rate the mocked-prototype gap as an observation, not a defect | defect / observation | the task item asked for profile and policy snapshots, which are present and can fail; production uses a separate scope `codex-lane-composition.ts:245` | yes |
| Use file modification times to confirm that r1 fixes did not change | re-read every file / mtimes plus diff | only the 4 files of revision 2 have times after the r1 review (16:49) | yes |
| APPROVED although the specs are not run | APPROVED / REVISE | read-only review by instruction; the coordinator runs `npm run verify` next | yes |

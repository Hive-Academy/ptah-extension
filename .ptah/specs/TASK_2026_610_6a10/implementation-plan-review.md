Verdict: REVISE

## Round 1 defect status

| Prior defect | Status | Evidence |
|---|---|---|
| 1. Text/note ownership and D1 dependency were unresolved | CLOSED | `context.md` “Gate 2 decisions 2026-10-04” assigns text/note to TASK_2026_594 `dashboard-catalog/3` and makes D1 wait; plan “Gate 2 decisions recorded” and batch D1 follow that decision. |
| 2. `ptahUiHint` had no authoritative Electron-only host fact | CLOSED | Plan components 11–12 and B8c add DI-owned `HOST_KIND`, register `'electron'` only in Electron phase-1 infrastructure, and use the exact three-part condition with non-Electron spoof cases in the truth-table tests. |
| 3. Parser/renderer lazy-load claim lacked a concrete bundle gate | CLOSED | Plan component 15 / A6 creates `scripts/eager-closure-gate.js`, reuses `assertEagerClosureKept`, compares baseline eager inputs, and fails forbidden static closure growth. |
| 4. Eight-live-block performance cap lacked an executable measurement | CLOSED | Plan component 9 specifies an instrumented 12-block test, a `liveCount() <= 8` assertion, detached-CDR checks, resolver counters, inert snapshots, and remount checks. |
| 5. Host-source registry compatibility had no regression test | CLOSED | Plan component 16 / A7 adds a sorted RPC/message registry baseline and deep-equality contract test, with the schema-only optional-field exception pinned separately. |
| 6. PR E remained improperly included in this approval | CLOSED | `context.md` Gate 2 decision defers PR E to a separate amendment; plan “Gate 2 decisions recorded” and Requirement 4 mark it deferred. |
| 7. Oversized or unverifiable B8/D1 batches | CLOSED | B8a (4 files, 2 libs), B8b (4, 1), B8c (3, 2), and D1 (6, 1) now have explicit lists within limits. |
| 8. Agent text could still forge the block-split marker | CLOSED | Plan component 12 makes the hint depend on the DI host fact, coding profile, and validated flag; its truth table covers absent, non-coding, VS Code, TUI, CLI, and spoofed inputs. |

## New defects

1. **D2 — major:** D2 remains described only as “text-block view-model mapping, node component, spec (<=6, derived from 594’s layout)” rather than an exact file list. Its six-file/two-lib limit and its claimed file-disjointness from D4 cannot be independently checked. **Fix:** after TASK_2026_594 supplies the layout, amend this plan with D2's concrete paths, owning libs, and the resulting parallel-group conflict check before beginning D2.

## Verified claims

- The planned host fact is not part of the RPC wire types: current `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:44` (`ChatStartParams`) and `:124` (`ChatContinueParams`) contain caller configuration fields but no `hostKind`. Plan components 11–12 place `HostKind` in the tsyringe token registry and inject it into `SdkQueryOptionsBuilder`, so an RPC caller cannot register or supply it.
- The planned Electron registration point is an Electron composition root: `apps/ptah-electron/src/di/phase-1-infra.ts:76` defines `registerPhase1Infra`; B8c registers the immutable `'electron'` value there and adds an Electron container smoke test. The plan’s non-Electron truth-table cases verify that missing/`vscode`/`tui`/`cli` values cannot emit the hint.
- The planned predicate exactly requires `hostKind === 'electron' && (mcpToolProfile ?? 'coding') === 'coding' && ptahUiFence === true` (plan component 12). The flag remains zod-validated at the chat RPC boundary in B8a/B8b; a true flag alone is insufficient outside Electron.
- The reuse target exists: `scripts/electron-only-chunks.js:154` defines `assertEagerClosureKept`, and `:195-200` exports it. Plan component 15/A6 explicitly creates `scripts/eager-closure-gate.js` to import that helper and run synthetic static/dynamic/baseline-growth cases plus the real-stats gate.
- A7 is a true registry-diff test: plan component 16 captures sorted `RPC_METHOD_NAMES` and `Object.values(MESSAGE_TYPES)` in `host-source-registry.baseline.ts`, then deep-compares current values in `host-source-registry.contract.spec.ts`; B8a separately pins the only permitted schema-field addition.
- B8a, B8b, and B8c meet the stated batch caps: B8a lists 4 files across `shared` and `rpc-handlers`; B8b lists 4 files in `rpc-handlers`; B8c lists 3 files across `vscode-core` and `ptah-electron`.
- The explicitly named parallel groups are file-disjoint: G-A1 (A1/A6/A7), G-B1, G-B2, and the named C/D pairs have no repeated paths. D2 cannot be verified until New defect 1 is resolved.

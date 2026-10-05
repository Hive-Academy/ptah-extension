# Batch C1 report — resolver and turn-source snapshot

## Req 3 coverage

| Clause | Assessment before C1 | C1 fix / evidence | Test |
| --- | --- | --- | --- |
| 3.1 Resolution equals the host-owned turn data | Already met | Resolver maps diff totals, test summaries, and usage values; snapshot builds those values from its supplied turn-local inputs. | `formats host scalars and keeps literal rows separate`; `builds terminal sources from the turn tree, change set, and block message` |
| 3.2 Pending | Gap | Source-table pending status now fills every declared cell (never a blank), and the rowless `$usage` table becomes a valid status list. | `keeps a pending source-table state surface-valid`; `keeps a rowless usage pending state surface-valid` |
| 3.3 Unknown name or field | Already met | Parsing rejects unknown source/field before resolution, with the named parse failure. | `ptah-ui-parser.spec.ts`: `rejects an unknown scalar field`, prototype-name rejection cases |
| 3.4 Unavailable | Gap | Existing scalar/list unavailable display was retained; source-table unavailable cells are now nonblank and validator-safe, including rowless `$usage`. | `keeps an unavailable source-table state surface-valid`; `keeps a rowless usage unavailable state surface-valid` |
| 3.5 Partial data and incomplete turns | Gap | Resolver continues to render binary/null counts and change-set notes; snapshot additionally identifies a finalized turn with a recognized non-terminal test command as incomplete. | `formats host scalars and keeps literal rows separate`; `marks a finalized turn incomplete when a test command remains non-terminal` |
| 3.6 Empty | Gap | Existing diff/tests empty messages were retained; a known rowless `$usage` source now resolves to a valid explicit empty list instead of an invalid zero-column table. | `keeps an empty source-table state surface-valid`; `keeps a rowless usage empty state surface-valid` |
| 3.7 Reload and remount | Already met | Snapshot resolution is pure and has no retained prior-turn state. It re-resolves its supplied turn inputs, so persisted change-set/tree availability is reflected on remount and unavailable inputs remain unavailable. | `uses the late change set when the same terminal turn is resolved again`; `marks absent change-set, execution-tree, and usage data unavailable rather than zero` |
| 3.8 Host owns values; literals remain separate | Already met | Only binding components are resolved; literal rows are untouched. | `formats host scalars and keeps literal rows separate` |

## A-6 resolution

The change set is recorded and pushed from the terminal lifecycle handler, but is not guaranteed to be available at the instant a `session:turnEnded` consumer resolves. `architecture-evidence.md:220-228` shows `ChangeSetStore` handles both `SESSION_TURN_ENDED` and the independent `GIT_TURN_CHANGE_SET` push, loads persisted sets by session, and stores them keyed by session/turn. `architecture-evidence.md:266-274` establishes that `session:turnEnded` participates in finalization. `architecture-evidence.md:368-375` establishes the recorder order: `onTurnEnded/onTurnFailed` → `recordTurn` → persisted append (`:249`) → `GIT_TURN_CHANGE_SET` broadcast (`:259-267`).

Therefore C1 resolves a finalized turn with `changeSet: 'pending'` as `$diff = pending`; a subsequent pure resolution with the pushed/persisted change set returns it as available. A terminal turn without a covering change set is unavailable. The late-push transition is pinned by `uses the late change set when the same terminal turn is resolved again`.

## Files changed

- `libs/shared/src/mcp-apps-contracts/ptah-ui-resolver.ts`
- `libs/shared/src/mcp-apps-contracts/ptah-ui-resolver.spec.ts`
- `libs/shared/src/lib/utils/turn-sources.utils.ts`
- `libs/shared/src/lib/utils/turn-sources.utils.spec.ts`

## Verification and counts

- Scoped diagnostics: 0 TypeScript errors, 0 warnings across all four changed files.
- Command invoked: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared --parallel=1`. The terminal wrapper returned no captured tail despite the Nx daemon recording task output hashes; no suite result is claimed from that blank capture.
- C1 spec coverage: 16 executable Jest cases across the two changed specs (10 resolver/pipeline cases, 6 turn-source cases), including 6 validator-through-pipeline state cases.

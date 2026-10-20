# Implementation Plan Revision 1 — TASK_2026_702_594d

| Finding | Change made | Plan line(s) |
| --- | --- | --- |
| S1 | Added optional external popover anchor with default trigger fallback and regression spec; hero/footer emit their actual button elements through board to shell. | 11, 27–29, 33, 52 |
| S2 | Replaced one limited history query with pinned and unpinned bounded reads, deduplication, activity sort, stable tie-break, archival choice and organization/non-organization fixtures. | 12, 37, 54, 72, 84–86 |
| S3 | Added six title-based Electron callers and Marketplace accessible-name caller in split selector batches; widened final five-literal search. | 43, 57–58, 63 |
| M1 | Added Aurora sub-barrel and native umbrella export; left UI root barrel untouched and required barrel spec. | 15, 27, 52 |
| M2 | Added deprecated chat component re-export removal and literal consumer check to 1A. | 23, 51 |
| M3 | Kept deferred chip mount in shell viewport clear of hero/notice; added rail spec to 2C and phase 3. | 35, 56, 59 |
| M4 | Ordered phase 2 batches and named notice input, dismiss output and HTMLElement creation payload. | 33–35, 47, 54–58 |
| M5 | Added post-593 sync from main, conflict resolution and two-PR default when phases 1–2 finish early. | 59–61 |
| m1 | Corrected cross-phase overlap list to include chat-ui root index and shell specs. | 47 |
| m2 | Removed selector files from 2C and assigned them only to 2D/2E. | 56–58 |
| m3 | Restricted main-before-rail DOM order to empty board; preserved populated Tab order and rail key handler spec. | 33, 55–56 |
| m4 | Marked Aurora notice hand-maintained in brand-mark input directory and required scanner-token check. | 41, 53, 75, 93 |
| m5 | Assigned stale activity-ticker harness comment to 2C. | 43, 56 |
| m6 | Named dedicated recent read a deliberate deviation from task-description NFR and justified it by dialog filter coupling. | 37 |
| m7 | Specified root-scoped setup store and refresh triggers; recorded design's alert/status split over AC12 wording. | 23, 35 |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| External anchor with internal-trigger fallback | Move shared popover; duplicate it | Current popover uses its own trigger wrapper (`native-popover.component.ts:84-85,218-222`); dock trigger is removed. | Yes |
| Two bounded history reads; exclude archived on organization hosts | One read; explicit archived status | Host sorts pinned before pagination and excludes archived by default in query mode (`session-list-query.ts:82-92,115-119`); non-org ignores pinned (`:100-110`). | Yes |
| Root-scoped shared setup store | Component-scoped state | Board and single-chat share the card and need consistent workspace status (`canvas-rail-board.component.ts:166`; `chat-empty-state.component.ts:82-90`). | Yes |
| Separate phases 1–2 and phase 3 PRs if gate remains closed | Hold all work | TASK_2026_593 merge is the explicit removal gate; approved dock work can proceed before it. | Yes |

## Lane-introduced constraints

- Aurora notice is hand-maintained and must pass the brand scanner-token static check.
- Selector closeout includes title, accessible-name and stale comment literals in addition to the old test id.

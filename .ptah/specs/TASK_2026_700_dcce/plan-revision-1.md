# Plan revision 1 — TASK_2026_700_dcce

D9 supersedes D3. Child sessions remain visible but have no tab action, availability copy, coordinator route, router use, view guard, toast or related test.

| Finding | Change made | Plan section |
| --- | --- | --- |
| S1 | Not applicable per D9. The approved child-tab action was removed, so no focus router, grid/single navigation path or related tests remain in the plan. | Inputs and constraints; C1; Contracts; Decisions |
| S2 | Page CSS owns the 1100/480 page-width band rules. One page band observer supplies `reservedTop` to the scene; scene tests set this input directly. | Chosen shape; D2; A2b; Contracts |
| S3 | Removed `resumeLast`, `canResume` and dock `chooseCurrentTab()` wiring. D7 renders the existing Start new action in that slot. | B; A2b; Contracts; Decisions |
| M1 | Not applicable per D9. The child-tab action and its failure toast, view guard and coordinator tests were removed. Existing unrelated toasts remain parity row 6. | C1; Contracts; Risks |
| M2 | D2 covers live child's second thin silver ring and persisted child's dimmed dashed ring plus `CS` monogram, with renderer tests. | D2 |
| M3 | A2 is split into A2a mechanical extraction with an unchanged DOM/test gate and A2b behavior/layout wiring, each capped at 40 tool calls. Their shared page files require strict sequential ownership; independent lanes remain file-disjoint. | Component and file map; A2a; A2b |
| M4 | Named all six integration specs, their DOM/text contracts, and the page component spec selectors; B, C2 and A2 phases say which contracts they preserve. | B; C2; Page DOM gates |
| m1 | No longer relevant to the design after D9 removed child-tab navigation; the tab-manager warning evidence was removed from the plan. | Codebase evidence |
| m2 | D9 removes both live-tab and no-tab availability copy from child cards; the prototype-only string is not introduced. | Inputs and constraints; C1 |
| m3 | D9 makes both the rail selected card and overlay pinned detail display-only; no tab-action input or output is planned. | C1; Contracts; Decisions |
| m4 | Added explicit CSS ban on alpha base-content `@apply` and alpha text colours because the alpha guard does not scan CSS. | Inputs and constraints; A2b |
| m5 | Reused the controller's optional `ThemeService` by adding a `toggleTheme()` forwarding method in A2b. | File map; A2b |
| m6 | Marked row 9's decorative six age bars “remove-proposed, approved D1” while keeping real recent-session fields. | Complete parity assignment |
| m7 | Specified that a grandchild child sphere orbits its immediate parent child. | D1 |
| L1 | Tagged degradation audit 294 as a D8 user/project standing rule. | Inputs and constraints |
| L2 | Tagged injected Logger for new logging as a D8 user/project standing rule. | Inputs and constraints |
| L3 | Tagged GSAP as allowed but not required under D8. | Inputs and constraints |
| L4 | Labeled external page template/style extraction as a task architecture choice, with the existing large page and chat-view precedent. | Chosen shape; A2a |
| L5 | Listed unmodified integration specs as explicit batch gates and named their selectors/text dependencies. | B; C2; A2a; A2b; Page DOM gates |
| L6 | Removed the proposed Resume last behavior under D7. | B; A2b; Contracts |
| L7 | Kept the cited 70px orbit and 8/12px plate gaps as approved design measurements. | D1 |

The A2a/A2b page-file overlap is required by the requested mechanical extraction followed by wiring. They are a sequential checkpoint under one page-file owner; no parallel lane edits those files. No production code, tests, build or Nx command was run.

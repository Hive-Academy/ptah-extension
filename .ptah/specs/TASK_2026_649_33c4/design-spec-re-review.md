Verdict: REVISE

## Review state

Reviewer: codex (CLI lane). Author: Claude ui-ux-designer subagent. Side: cross-side. Round: 1 re-review.

## Findings status

| Original finding | Status | Evidence and remaining change |
| --- | --- | --- |
| 1. Chat chrome and D1 | RESOLVED | `design-spec.md` §11 note 1 and `decisions.md` D8 define the user-agreed exception: 649 adds only the byte-identical token file, barrel export and embed `chrome` input; 677 owns the ChatView reads. The spec covers behaviour before and after 677 and accepts duplicate stats until then. No other 649 chat-lib edit is specified. |
| 2. Configure placeholder | RESOLVED | §4 uses the normal chat placeholder and puts first-step guidance in §5.4. §11 note 3 reserves tab-targeted prefill for sendable preset and retry text (D6). |
| 3. Shared launcher split | RESOLVED | §11 entry sequence uses a builder-local adapter and existing tab APIs (D5). It leaves `WorkflowTabLauncherService` unchanged and limits grid-cap handling to grid-adopting callers; §6 and §12 row 58 follow that scope. |
| 4. Stack handoff and page binding | PARTIAL | §5.3, §5.8 and §11 notes 4 and 6 define a tab-and-workspace keyed record, validation, reload lookup and wrong-kind state. However §11 entry step 3(e) sends the first New Project turn before step 3(f) writes the record, while note 4 explicitly requires the write before the first turn. Put the validated durable write before sending, and make the route parameter (or an equally stable page-instance binding) authoritative across reload; a single mutable “active builder tab id” is insufficient when another builder is opened. |
| 5. Preview snapshot precedence | PARTIAL | §5.4 rules 1–5 specify ownership, per-field merge, clearing and workspace isolation. Rule 2 ignores an agent proposal from a turn started before a user choice while live, but says that after reload only proposal write times decide. A late result from that older turn can then replace the user choice. Persist the turn-start ordering needed to apply the same stale-result rule after reload, or define another durable precedence rule that preserves that choice. |
| 6. Parity row 54 | RESOLVED | `decisions.md` D7, §2 decision 8, §5.5 and §12 row 54 keep search-skills/create-skill through existing agent tools and wire the other three endpoints. The user chose that scope. |
| 7. Narrow sheet focus | RESOLVED | §8 covers close causes, focus return, host-width transition and dialog-over-sheet `inert` restoration. The revised prototype documents keyboard checks; the new unavailable and wrong-kind screenshots show their specified states. |
| 8. Inherited guidance label | RESOLVED | §13 places the 304 px and one-primary-button recipe under “Inherited 648/677 design guidance,” separate from project rules and lane-proposed constraints. |

## New findings

None. The two remaining inconsistencies are continuations of original findings 4 and 5.

## Decisions for the user

None. D7 and D8 record the user-reserved scope decisions; the remaining corrections are design details.

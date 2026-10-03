# Part B Requirements Review - TASK_2026_609_c495

## Round 0 history

- Author: in-process project-manager subagent; reviewer: CLI lane codex; round: 0; verdict: REVISE.
1. Serious — Non-Claude empty-field behavior conflicted with default/template inheritance.
2. Serious — Validation and OpenCode load guarantees conflicted; accepted formats were undefined.
3. Serious — Machine versus workspace model-setting scope was unresolved.
4. Serious — Deferred content-update detection and an unsupported F3 PR #634 hold entered scope.
5. Serious — Provenance omitted plugin, unknown, legacy and mixed-analysis-run cases.
6. Serious — Conditional skills trajectory acceptance allowed the capability to be omitted.
7. Minor — Parity verification required tests where inventory rows named none.
8. Minor — Candidates citation pointed to clones and omitted bulk candidate operations.
9. Minor — Open questions mixed product choices, contract lookups and excluded work.

## Round 1

- Author: in-process project-manager subagent
- Reviewer: CLI lane codex
- Round: 1
- Verdict: REVISE

Bounded document recheck of the nine findings against the revised requirements, parity inventory and recorded user decisions. Settled areas were not re-reviewed. One code spot-check examined the newly cited candidates section at `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts:185-341`. No runtime tests, provider documentation research or implementation review was performed.

### Per-finding status

| Finding | Status | Evidence and assessment |
| --- | --- | --- |
| 1 | Resolved | `task-description.md:80-90,106-110` defines workspace-agent → workspace-default → machine-default precedence, Claude-only template fallback, and no non-Claude model field when no value resolves. Clearing values now has deterministic inheritance. |
| 2 | Partly resolved | `task-description.md:92-115` separates empty, malformed, known-invalid, unlisted and unverifiable outcomes and bounds the OpenCode guarantee. However, the ordinary listed-valid case has no table outcome, and `:102` prohibits loosening syntactic rules that have not yet been verified. See residual findings below. |
| 3 | Resolved | `task-description.md:25,80,106,113-114,197` implements the recorded machine default plus workspace overrides, identifies the effective source and distinguishes intentional machine-wide saves from saves affecting only X. The Part A contract lookup remains an explicit dependency. |
| 4 | Resolved | `task-description.md:43,73` defers update detection and retains link-only access to existing rebase; `:201` removes the unsupported F3 hold. `parity-inventory.md:43` agrees. |
| 5 | Resolved | `task-description.md:45,67,126,189,199` adds plugin and unknown origins, requires recorded evidence, attributes runs per agent, handles mixed runs and agents with no recorded run, and excludes historical backfill. |
| 6 | Partly resolved | `task-description.md:30,44,153-154` now mandates a workspace-level summary, a fixture and empty/unavailable states. However, the claimed equivalence between captures from this workspace and the cited This project set is false for candidates with no recorded project. See residual finding below. |
| 7 | Partly resolved | `task-description.md:163-164` adds bounded checks and requires actual coverage evidence; `parity-inventory.md:22-23` supplies procedures. Those procedures still omit enhancement retry and permit Cancel instead of exercising per-item retry. |
| 8 | Resolved | `task-description.md:153,225` and `parity-inventory.md:45-48` separate the summary from candidate management and correct the citations. The single code spot-check confirms the candidates case at `:185`, table at `:327`, per-row actions at `:333-338`, bulk controls at `:283-319`, and maintenance actions at `:251-281`. |
| 9 | Resolved | `task-description.md:38,42,195-205` keeps deletion and other-tab routing excluded, moves Part A lookups to dependencies, and retains only explicit approval of the proposed Welcome-list removal as an open question. |

### Remaining findings and revision-introduced gaps

1. **Serious — Finding 2 remains incomplete: the validation table omits listed-valid models.** `task-description.md:94-100` has no row for a well-formed value present in the provider's returned model list, with no provider-reported error. AC 3.3 at `:108` authorizes writing only values the table accepts, and AC 3.6 at `:111` delegates acceptance to that table. Add the normal listed-valid outcome (accept and write without unlisted confirmation) and make category precedence explicit where a provider-reported error overlaps list membership. This gap is introduced by the replacement table, within finding 2's scope.

2. **Serious — Finding 2 still treats unverified format restrictions as irreversible requirements.** `task-description.md:97` imposes exactly one slash for OpenCode and whitespace restrictions for the other providers, while `:102` acknowledges that provider syntax remains unverified but permits the architect to tighten, never loosen, those rules. This prevents authoritative provider evidence from correcting an over-restrictive rule. Require the architect to establish and cite each supported provider's syntax before implementation, allowing correction in either direction; retain the explicit acceptance/write outcomes and bounded load guarantee. No claim is made here that any particular provider accepts an excluded format; the defect is the unsupported prohibition on correcting the provisional rules.

3. **Serious — Finding 6 has a contradictory workspace-membership definition.** `task-description.md:153` defines trajectory as candidates captured in the active workspace and also as exactly the set returned by Thoth's This project filter; `:154` calls the empty state “No skills captured for this workspace yet.” The newly cited code explicitly says that filter includes captures whose project was never recorded (`libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts:235-239`). The three-plus-one fixture does not cover this fifth, unknown-project case. Specify whether unknown-project captures are excluded or included with an explicit unknown-project label, align the counts and empty state, and add that case to the fixture. Do not attribute legacy unknown captures to the active workspace merely because the existing filter returns them. `parity-inventory.md:45` must describe the same chosen set.

4. **Minor — Finding 7's manual checks still do not prove the retry capabilities.** `parity-inventory.md:22` inventories run/skip/retry but checks only Run and Skip; `:23` inventories per-item retry but allows “Retry ... (or Cancel).” Thus the evidence required by `task-description.md:163-164` can be recorded without demonstrating either retry path. Add a bounded failure fixture and explicit expected retry result for each row, or name a test that actually exercises that retry capability; Cancel is not substitute evidence for Retry.

No additional independent scope findings were raised beyond these residual/revision-introduced gaps in findings 2, 6 and 7.

### User decisions and scope traceability

- **Machine default plus workspace overrides: reflected.** `context.md:62` is carried into `task-description.md:25,80,106,113-114,197`; deliberate machine-default edits are the explicit cross-workspace exception.
- **Content-manifest update detection deferred: reflected.** `context.md:63` is carried into `task-description.md:43,73` and `parity-inventory.md:43`. Existing rebase remains available through its current surface. The follow-up's actual task identifier is not supplied in these inputs; this does not put detection back into Part B.
- **No new untraced feature scope identified.** The workspace summary and provenance fallbacks answer findings 5–6 and the original trajectory request (`context.md:7-8`); the machine/workspace rows answer the scope decision. Provider validation outcomes answer finding 2, although their syntax restrictions still need the correction above. No new body-editing, other-tab routing, deletion or update-detection capability was introduced.

## Unresolved items

- Author: complete finding 2's listed-valid acceptance/write outcome and remove the unsupported restriction on correcting provisional provider syntax.
- Author: resolve finding 6's unknown-project membership, labeling, counts and fixture consistently with the intended workspace summary.
- Author: complete finding 7's explicit retry verification procedures or covering test references.
- Architect: verify provider syntax/discovery/error capabilities and Part A/provenance contracts as already assigned in the requirements; this recheck does not substitute for that work.
- User's proposed-removal decision remains pending under `task-description.md:205`; keep the Welcome saved-analyses entry point until approval. This is not a new blocker or a request to reopen settled scope.

## Round 2

- Author: in-process project-manager subagent
- Reviewer: CLI lane codex
- Round: 2 (final automatic round)
- Verdict: REVISE

Rechecked only findings 2, 6 and 7 and issues introduced by their round 2 edits. Earlier review sections are retained as history; this section supersedes their statuses for these three findings. No code spot-check, runtime test, external research or git operation was needed for this document recheck.

### Per-finding status

| Finding | Status | Evidence and assessment |
| --- | --- | --- |
| 2 | Partly resolved | `task-description.md:97` adds Listed-valid with acceptance and emission without confirmation; `:103` makes known-invalid errors take precedence over list membership. `:105` now allows cited provider evidence to correct provisional syntax in either direction. Both round 1 gaps are addressed, but the new fallback in the final sentence of `:105` conflicts with the table and precedence for listed models when syntax cannot be independently verified; see the new finding below. |
| 6 | Resolved | `task-description.md:156` explicitly limits membership and counts to candidates recorded for the active workspace, excludes unknown-project captures, explains the exclusion, and adds the fifth fixture candidate with explicit expected counts. `:157` covers the unknown-only empty state. `parity-inventory.md:45` describes the same narrower set without changing Thoth's existing filter. |
| 7 | Resolved | `parity-inventory.md:22` now requires an enhancement failure, restored dependency and successful Retry result. `:23` requires one failed item among two, retry to completion and file emission without rerunning the completed item; Cancel is explicitly separate. These procedures now supply retry evidence under `task-description.md:166-167`; they are planned checks, not claims that tests have already passed. |

### New findings introduced by round 2

1. **Serious — Validation classification is contradictory when syntax is unverified but the model is listed.** `task-description.md:105` says that when provider syntax cannot be verified, values passing the provisional check are Unlisted or Unverifiable, never Listed-valid. Consider a value that passes that check, appears in the provider's returned model list, and has no provider-reported error. The table at `:97` and first-match order at `:103` classify it Listed-valid. Neither alternative in `:105` fits: Unlisted requires absence from the list (`:100`), while Unverifiable requires an absent CLI or no model list (`:101`). The resulting confirmation, label and acceptance outcome required by `:114` is therefore not deterministic. Resolve this case explicitly: either allow provider list membership to establish Listed-valid without separately verified general syntax, or define an overriding syntax-unverified class/condition with a single acceptance, label and write outcome. Add this combination to the validation fixture. This finding is limited to the newly added fallback; the evidence-based ability to correct provisional syntax is accepted.

### Unresolved items

- Author: resolve the sole remaining validation-classification contradiction at `task-description.md:97-105`, including the listed-model / unverified-syntax case in the checkable outcomes.
- Findings 6 and 7 have no remaining document-review items. Findings resolved before round 2 were not reopened.
- Existing downstream contract verification and the pending proposed-removal approval remain as previously recorded; neither is a new round 2 finding. This verdict does not validate runtime behavior or provider formats.

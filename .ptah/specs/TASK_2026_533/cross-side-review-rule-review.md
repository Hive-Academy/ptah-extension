REVISE

The change establishes independent review before Gates 1, 1.7 and 2 and explicitly retains user approval. That matches the orchestrator's stated framing; the quoted user request does not explicitly authorize removing those gates. The implementation is incomplete: reviewer routing, continuation, revision termination and shipping-code integration still disagree. No skill source or mirror was changed by this review.

Locations below are relative to `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/` and refer to the uncommitted working-tree contents reviewed on 2026-09-23.

1. **P1 — “Other side” permits the same side and does not respect disabled lanes explicitly.**

   **Locations:** `agent-lanes/SKILL.md:155`, `agent-lanes/SKILL.md:157`, `orchestration/SKILL.md:66`, `orchestration/references/lane-assignment.md:31`, `orchestration/references/lane-assignment.md:78`, `orchestration/references/checkpoints.md:73`.

   **Problem:** The definition has exactly two sides, but a different CLI family is offered as a normal other-side review of CLI-authored work. That fails the user's requested CLI-to-subagent direction. Conversely, subagent-to-CLI is mandatory even when Gate 0.1 says never spawn a lane. “No other side available” does not distinguish a missing tool from a prohibited tool. Automatic same-side fallback can also conflict with the rule allowing same-family review only at the user's request. Direct in-process authorship, which the lane-assignment file already permits, has no classification.

   **Exact proposed wording:** Replace the routing portion of the cross-side bullet with:

   > **Cross-side review**: side means execution mode: in-process (orchestrator or subagent) or CLI lane. Family means the model family, not the execution side. For decision artifacts and shipping code, the orchestrator assigns an independent reviewer: in-process author → CLI lane; CLI author → subagent. A different CLI family is still the same side. If the opposite side is unavailable or disabled by Gate 0.1, use a fresh reviewer on the available side and disclose the reason; prefer a different family. Label same-family fallback as weaker evidence. Never reuse the author as reviewer. If no independent reviewer can run, report the blocker instead of claiming a review occurred.

   Replace the current Independence bullet with:

   > **Independence**: the author never reviews its own work. Same-family review is allowed when the user requests it or when the disclosed fallback above is necessary; label it as weaker evidence.

   Replace the parenthetical routing in `orchestration/SKILL.md:67` with:

   > (routing and disclosed fallback per agent-lanes §6)

   Replace the Document review row's last cell in `lane-assignment.md:78` with:

   > The opposite execution side from the author, with the disclosed fallback in agent-lanes §6

   Append to `lane-assignment.md:31`:

   > This includes review lanes: use the disclosed same-side fallback. In `auto` mode, required reviews qualify as useful lane work.

2. **P1 — Shipping-code review has competing routing and output contracts.**

   **Locations:** `agent-lanes/SKILL.md:153`, `agent-lanes/SKILL.md:159`, `agent-lanes/SKILL.md:161`, `orchestration/references/lane-assignment.md:77`, `orchestration/references/team-leader-modes.md:50`, `orchestration/references/strategies.md:206`, `orchestration/references/checkpoints.md:455`.

   **Problem:** The existing code row permits any different-family CLI or the orchestrator's own review. The new bullet instead mandates the other side and appears to assign shipping code an undefined `<artifact-stem>-review.md` and document verdict format. Team-leader still requests a named specialist without side selection. DEVOPS goes directly from implementation to optional QA, so `skip` can bypass the newly mandatory shipping-code review; creative flows likewise need a required review before completion. Existing code review should satisfy this rule when eligible, rather than triggering a second duplicate review.

   **Exact proposed wording:** Replace the first sentence of the Code that will ship row, retaining its write-path trace:

   > Independent review using the cross-side routing below, recorded in `code-logic-review.md` under the code-review role's existing verdict contract.

   Limit the new deliverable sentence to:

   > Document reviews write `<artifact-stem>-review.md` with verdict APPROVED / REVISE; shipping-code reviews retain `code-logic-review.md` and its role contract. An existing review that meets the routing and scope requirements satisfies this rule; do not duplicate it.

   Replace the Review row's last cell in `lane-assignment.md:77` with:

   > The opposite execution side from the implementer, with the disclosed fallback in agent-lanes §6

   Replace the `NEEDS REVIEW` action in `team-leader-modes.md:50` with:

   > Orchestrator selects the reviewer's execution side per agent-lanes §6, invokes the requested code-review role, then re-invokes Mode 2 with `code-logic-review.md` and its verdict.

   Add a common rule in `strategies.md` and a reference to it above Gate 3's options:

   > Every implementation receives the required shipping-code review before batch acceptance or, for flows without team-leader, before completion or git operations. Gate 3 selects additional QA; `skip` does not waive the required review.

3. **P1 — Continuation can skip the gate, accept a stale review or confuse reviewer approval with user approval.**

   **Locations:** `orchestration/references/task-tracking.md:118`, `orchestration/references/task-tracking.md:135`, `orchestration/references/task-tracking.md:141`, `orchestration/references/task-tracking.md:146`.

   **Problem:** “The furthest row that matches” makes each new document-review file match the later generic “review / test reports” row, potentially selecting QA or finish before its gate. The new rows only test file existence, not verdict, reviewed revision or revision budget. “If not approved” is ambiguous now that both reviewer and user say APPROVED. An edited plan can inherit an old approval. Literal execution primarily bypasses revision; an implementation trying to repair that omission can repeatedly resume REVISE without a persisted round counter.

   **Exact proposed wording:** Replace the sentence before the table with:

   > First check applicable document reviews and user gates in order (1, 1.7, 2). Resume the earliest unfinished one before selecting a later phase. A review or user approval applies only to the artifact revision it names. Document-review reports do not match the QA row below.

   Replace the three document rows with:

   ```markdown
   | `task-description.md` | Resume document review and Gate 1 for the current revision; continue only after recorded user approval |
   | `design-spec.md` + `prototype/` | Resume document review and Gate 1.7 for the current revision; continue only after recorded user approval |
   | `implementation-plan.md` | Resume document review and Gate 2 for the current revision; continue only after recorded user approval |
   ```

   Replace the generic report row with:

   > | QA reports (`test-report.md`, `code-style-review.md`, `code-logic-review.md`, `visual-review.md`) | After required document gates and batch work, continue the chosen QA or finish |

   Replace the wildcard layout entry with:

   > `task-description-review.md`, `design-spec-review.md`, `implementation-plan-review.md` — document-review evidence

4. **P1 — The revision cap has no shared terminal behavior or current-revision recheck.**

   **Locations:** `agent-lanes/SKILL.md:167`, `agent-lanes/SKILL.md:169`, `orchestration/SKILL.md:9`, `orchestration/SKILL.md:67`, `orchestration/references/checkpoints.md:197`, `orchestration/references/checkpoints.md:340`, `orchestration/references/checkpoints.md:419`, `orchestration/references/checkpoints.md:547`.

   **Problem:** “Finish it yourself” conflicts with the orchestrator's no-direct-implementation rule and can produce unreviewed final changes. The templates allow REVISE after round n/2, but do not say whether to present round 1 immediately or finish both rounds first. There is no author→reviewer sequence, persisted counter or explicit endpoint after round 2. User feedback and decomposition failure send revised artifacts straight back to gates without refreshing the review. User rejection loops are separate from the automated reviewer loop and should remain so.

   **Exact proposed wording:** Add one shared protocol in `checkpoints.md`, referenced by continuation and all three gates:

   > The orchestrator sends REVISE findings to the original author, then returns the changed artifact to the independent reviewer. One revise round is one author revision plus one reviewer recheck; the initial review is round 0. Allow at most two automatic revise rounds per artifact and user-requested scope. Record the author, reviewer, execution sides, reviewed revision, completed round count, verdict and unresolved items in the review file; record the user's gate decision against that revision in `context.md`. Resume these records rather than resetting the count.
   >
   > On reviewer APPROVED, present the user gate. After round 2 still says REVISE, stop automatic revision and present the gate with the current verdict and every open item. The reviewer verdict never counts as user approval. Wait for the user's decision; do not implement while approval is pending. A user-requested revision must receive a current review before the gate is presented again; a new automatic revision budget requires an explicit user request to continue or a changed scope. User questions without artifact changes do not require another review.

   Replace the revise-cap bullet with:

   > **Revise cap**: at most 2 author/reviewer revision pairs after the initial review. Announce the cap first. At exhaustion, report unresolved items; document workflows present their user gate per orchestration checkpoints. The orchestrator does not take over the author's edits.

   In all three gate templates replace the verdict placeholder with:

   > **Reviewer verdict**: [APPROVED | REVISE — automatic revision cap reached] · **Completed revise rounds**: [0–2] · **Reviewed revision**: [revision] — 📄 `<taskFolder>/<artifact-stem>-review.md`

   Replace rejection-handling step 4 at `checkpoints.md:547` with:

   > 4. Refresh the independent review for the changed artifact, then re-present the checkpoint with its current verdict and open items.

5. **P2 — Reviewer ownership and the subagent invocation contract are missing.**

   **Locations:** `agent-lanes/SKILL.md:82`, `agent-lanes/SKILL.md:163`, `orchestration/references/lane-assignment.md:14`, `orchestration/references/agent-catalog.md:54`, `orchestration/references/agent-catalog.md:71`.

   **Problem:** The orchestrator already may spawn every phase; it should explicitly own this independent review rather than leaving the author to arrange it. “Pass no role” applies to a CLI parameter, but gives no subagent selection recipe. Every catalog specialist has an output contract, and the code-review roles specifically write code-review files. Omitting a CLI role does not solve the subagent half. The blanket claim that role contracts name code-review files is also too broad: other roles name requirements, research and plans.

   **Exact proposed wording:** Replace the role sentence in §6 with:

   > Document-review invocation and ownership follow orchestration's agent catalog; do not reuse a code-review role with a conflicting deliverable contract.

   Add under `agent-catalog.md` Invocation:

   > **Document review**: the orchestrator invokes the reviewer after the author returns. Use a discovered document-review role if it supports this deliverable; otherwise use an available generic subagent, or a CLI lane without `role`, with the explicit contract below. Do not assume a generic subagent or role exists; if the selected side cannot supply one, apply agent-lanes §6 fallback. This is an exception to the specialist invocation table, not a code-logic-reviewer invocation.
   >
   > Supply absolute paths to the artifact, exact user request, project rules, prior approved artifacts and parity inventory when applicable. For design review include `prototype/` and its evidence. Give read-only access to source and artifacts; allow writing only `<artifact-stem>-review.md`. Require APPROVED / REVISE, requirement coverage, introduced constraints, parity deltas, feasibility evidence and numbered findings with `file:line`. For a missing requirement, cite its source and the artifact section where it belongs. Require the review-state fields from checkpoints and `WROTE: <absolute path>` plus a headline. CLI calls declare the same path in `deliverables`.

6. **P2 — Phase and team-leader handoffs do not carry the new evidence.**

   **Locations:** `orchestration/references/strategies.md:35`, `orchestration/references/strategies.md:43`, `orchestration/references/strategies.md:54`, `orchestration/references/strategies.md:116`, `orchestration/references/strategies.md:146`, `orchestration/references/strategies.md:198`, `orchestration/references/strategies.md:270`, `orchestration/references/strategies.md:445`, `orchestration/references/team-leader-modes.md:14`, `orchestration/references/team-leader-modes.md:30`, `orchestration/references/team-leader-modes.md:48`.

   **Problem:** Every strategy still jumps from author to gate. The common SKILL rule is authoritative, but the execution reference omits the step agents will follow. Mode 1 receives no explicit review/gate evidence, and completion does not audit it. A decomposition rejection revises the architecture then immediately runs Gate 2. Team-leader should consume document-review evidence, not become another document reviewer or start another review loop.

   **Exact proposed wording:** Add before the strategy flows:

   > Every applicable document gate below follows `author → independent document review → bounded revision → user gate` per checkpoints. Include the review step in the announced agent sequence. This applies to initial artifacts and revisions, including creative design and SaaS requirements.

   Insert `INDEPENDENT DOCUMENT REVIEW (checkpoints protocol)` immediately before each Gate 1, 1.7 or 2 validation in the phase lists. Replace the creative step at `strategies.md:445` (and its design-only counterpart at line 489) with:

   > Run independent document review; present Gate 1.7 with the current review, then follow its revision protocol until the user approves.

   Add under team-leader Modes:

   > Mode 1 receives the current plan, applicable document-review paths and recorded user gate decisions, including any open items the user explicitly accepted. Missing or stale evidence returns a blocker to the orchestrator. Mode 3 verifies this evidence remains applicable and required shipping-code reviews exist; it does not commission duplicate document reviews. Flows that legitimately skip an artifact do not require its review file.

   Replace the `DECOMPOSITION BLOCKED` action with:

   > Re-invoke software-architect with the blocking issues, refresh the independent document review, then present Gate 2 again.

7. **P2 — Mandatory plan review conflicts with the “Never on a lane” judgment restriction.**

   **Locations:** `orchestration/references/lane-assignment.md:58`, `orchestration/references/lane-assignment.md:60`, `orchestration/references/lane-assignment.md:78`.

   **Problem:** Mandatory CLI review of subagent-authored architecture asks for feasibility judgments, while cross-cutting architecture judgment and security-critical review decisions are prohibited on lanes. Design review also needs to be distinguished from the browser-based visual-reviewer role. The new text does not delimit advisory review from final decision ownership.

   **Exact proposed wording:** Replace the last Never on a lane item with:

   > Final security-critical decisions and cross-cutting architecture approval. A lane may supply advisory document-review findings; the orchestrator presents them at the user gate. A review needing evidence or capabilities the lane lacks must state that limitation and use the disclosed fallback rather than assert approval.

   Add after the document-review row:

   > Design document review checks the spec, prototype and supplied evidence. It does not replace the required browser-based visual review of implemented UI.

8. **P2 — Cost is covered generally, but the new mandatory work is absent from the announced sequence.**

   **Locations:** `agent-lanes/SKILL.md:204`, `orchestration/SKILL.md:28`, `orchestration/references/lane-assignment.md:114`, `orchestration/references/checkpoints.md:62`.

   **Problem:** §8 already requires announcing every review round, so there is no total absence of cost policy. However, rosters and phase lists do not include the new document reviews. This does not necessarily double all calls per task: it adds one initial reviewer invocation per applicable artifact, plus up to four more invocations for two author/reviewer revision pairs. With all three artifacts that is +3 baseline invocations and up to +12 revision invocations, excluding failures or further user-requested changes. Inner tool calls and token cost vary; invocation counts are not a price estimate. These are additions to authoring, implementation and existing code review, not a second full SDLC.

   **Exact proposed wording:** Append to the first §8 paragraph:

   > Include required document reviews in the estimate: one initial reviewer invocation per artifact, plus up to two author/reviewer pairs (four more invocations). Announce the baseline and cap, including same-side fallback reviewers; do not duplicate an existing eligible code review.

   Add to Gate 0.1's explanatory text:

   > Required document reviews run before user approval: one initial review per applicable artifact, with at most two author/reviewer revision pairs. If you disable CLI lanes, fresh subagents perform disclosed same-side reviews.

   Replace lane-assignment Flow step 3 with:

   > For each phase in order: invoke the author with the prior approved artifact, run the required independent review, present the user gate, then pass the approved artifact on.

The new prose is otherwise concise and consistent with the files' imperative voice. The additions introduce no vendor names; existing examples already contain them and are outside this change. `agent-lanes/SKILL.md` is currently **216 lines**, below the requested ~230-line limit. Keep routing and output distinctions there; place the longer invocation and revision protocol in the orchestration references as proposed, replacing overlapping text instead of appending duplicate rules.

Validation: read-only Git diff/status and source inspection of all eight requested files; traced enabled/disabled lane selection, both authorship directions, REVISE rounds 0–2, user revisions, continuation with report files, decomposition rejection and optional-QA paths. No application tests were run for this documentation-only review. Mirrors and `content-manifest.json` were not modified or independently audited.

## Round 1 recheck

**Verdict: REVISE**

- **Author:** calling orchestrator, in-process author (as identified in the review request).
- **Reviewer:** this continuing CLI-lane review session.
- **Execution sides:** author — in-process; reviewer — CLI lane.
- **Reviewed revision:** the current working tree, inspected on 2026-09-23; the eight plugin-source skill files named in the request.
- **Completed revise rounds:** 1.
- **Unresolved items:** R1–R5 below. No second revision round has been performed.

The main review protocol and deliverable separation are now present. Four findings are closed; four retain specific integration gaps. The deliberate code-takeover exception is reasonable as an explicitly bounded policy, but the current wording still contradicts the orchestration role and leaves the takeover's failure endpoint unspecified. The reported TASK_2026_534 incident motivates independent verification; this recheck did not independently inspect that task.

### Findings 1–8

1. **Not closed — routing terminology and disabled-lane behavior fixed; pinned rosters still conflict.** `agent-lanes/SKILL.md:157` now distinguishes execution side from family and routes both directions correctly; `agent-lanes/SKILL.md:160` and `orchestration/references/lane-assignment.md:31` cover disabled/unavailable lanes. However, `lane-assignment.md:87` still mandates spawning an explicitly pinned CLI reviewer, while §6 only permits same-side routing when the other side is unavailable or lanes are disabled. The all-CLI relay at `lane-assignment.md:71` and example at `lane-assignment.md:100` still advertise normal same-side code review based on family alone. Resolve R1; do not silently replace a user's pinned reviewer.

2. **Closed — shipping-code routing and output contract are integrated.** `agent-lanes/SKILL.md:153` and `agent-lanes/SKILL.md:164` preserve `code-logic-review.md` and its role verdict, separate document review files, and avoid duplicate eligible reviews. `orchestration/references/team-leader-modes.md:56` routes the requested code-review role through §6. `orchestration/references/strategies.md:5` and `orchestration/references/checkpoints.md:483` make shipping-code review mandatory even when additional QA is skipped. The remaining pinned-roster exception is tracked under finding 1 rather than counted twice.

3. **Not closed — stale-review and gate bypass fixed, but the new exclusion also names legitimate QA reviews.** `orchestration/references/task-tracking.md:137` now checks gates first and binds approval to a revision; lines 146–148 explicitly resume the document gates. `checkpoints.md:40` persists the reviewer verdict and completed round count. However, `task-tracking.md:139` says “a review file never matches the QA row,” while line 151 explicitly puts three review files in that row. This is a new wording contradiction, not the original document-review bypass. Scope the exclusion to document reviews (R2). Also qualify the initial gate sweep as applicable to the selected flow, consistent with R5.

4. **Not closed — document termination works, but the code exception and renewed-budget state remain inconsistent.** `orchestration/references/checkpoints.md:34` defines author/reviewer sequencing, round 0 and two automatic revision pairs; line 43 presents the gate with open items at exhaustion; line 46 requires a fresh review after user changes. `checkpoints.md:571` refreshes the review on rejection. These close the original document-loop and stale-review paths. However, `agent-lanes/SKILL.md:170` allows direct code takeover while `orchestration/SKILL.md:9` still says “You never implement directly.” Separately, `checkpoints.md:41` says never reset the count and line 47 allows a new budget without defining how it starts. Resolve R3 and R4.

5. **Closed — reviewer ownership and invocation are explicit.** `agent-lanes/SKILL.md:159` assigns selection to the orchestrator. `orchestration/references/agent-catalog.md:93` provides a distinct document-review invocation, permits only a compatible role, supplies generic/roleless alternatives and falls back if the selected side cannot supply one. Lines 100–106 provide inputs, write scope, requirement tracing, evidence, review state, reply shape and CLI `deliverables`. This is sufficiently explicit without inventing an installed reviewer role.

6. **Not closed — phase coverage and handoffs are implemented; skipped-artifact evidence needs one qualification.** `orchestration/references/strategies.md:5` defines the shared sequence. All nine `USER VALIDATES` steps have an adjacent independent document-review step; creative paths also have the step at lines 469 and 513. `team-leader-modes.md:40` adds Mode 1/3 evidence and line 54 refreshes review after decomposition rejection. But line 40 unconditionally requires an approved plan and gate decisions, while line 14 explicitly starts BUGFIX Mode 1 immediately after init. Lines 43–44 exempt only the missing review file, not the skipped plan and gate decision themselves. Make the whole evidence requirement conditional (R5).

7. **Closed — advisory review is distinguished from final judgment and visual QA.** `orchestration/references/lane-assignment.md:61` reserves final security/architecture approval, permits advisory findings, requires disclosure/fallback when evidence or tools are missing, and distinguishes design-document review from browser review of implemented UI. No additional approval step is introduced.

8. **Closed — required reviewer cost is now announced.** `agent-lanes/SKILL.md:206` includes one initial reviewer invocation plus up to two author/reviewer pairs in the call estimate. `orchestration/references/checkpoints.md:59` explains the review cost and disabled-lane fallback at discovery; `strategies.md:7` includes reviews in the announced sequence. This describes incremental work, not a claim that every task doubles in total calls.

### Remaining changes and new contradictions

**R1 — P2: make explicit user-pinned same-side review a disclosed override, and label relay examples accordingly.** Evidence: `agent-lanes/SKILL.md:160`; `orchestration/references/lane-assignment.md:71`, `:87`, `:102`. This is the remaining part of finding 1 exposed by the tightened default routing.

Exact replacement for the fallback sentences at §6:

> Opposite side unavailable, lanes disabled at Gate 0.1, or the user explicitly pins a same-side reviewer → use an independent reviewer on that side and disclose the reason. Prefer another family when the user has not pinned one. Never silently replace a pinned reviewer. No independent reviewer can run → report the blocker; never claim a review.

Replace the relay claim at `lane-assignment.md:71` with:

> Authoring phases may all run on CLI lanes. Reviews still use the opposite execution side unless a disclosed fallback or explicit user-pinned same-side reviewer applies under agent-lanes §6.

Replace the example's independence explanation at line 102 with:

> This explicitly pinned example uses independent, same-side CLI review. Disclose that override; different families do not make it cross-side. Without an explicit override or unavailable opposite side, route CLI-authored work to a subagent reviewer.

**R2 — P2: distinguish document-review files from QA reports.** Evidence: `orchestration/references/task-tracking.md:137` and `:151`. The new broad exclusion contradicts the enumerated QA row.

Exact replacement for the opening continuation paragraph:

> Read `task.md` for status and `Glob` the folder. First check the document reviews and user gates applicable to the selected flow, in order (1, 1.7, 2), and resume the earliest unfinished one. A review or approval applies only to the artifact revision it names. Document-review files never match the QA row. Otherwise the furthest row that matches decides.

**R3 — P1: integrate and bound the deliberate code-takeover exception.** Evidence: `agent-lanes/SKILL.md:170`; `orchestration/SKILL.md:9`. Independent verification is a sound requirement and closes the unverified-takeover risk. It does not itself override “never implement directly,” and “finish it yourself” must not become an unlimited new revise loop after the cap.

Exact replacement for the final sentence of `orchestration/SKILL.md:9`:

> Delegate implementation, except for the bounded post-cap code correction in agent-lanes §6; any code you change requires independent review before acceptance.

Exact replacement for the §6 revise-cap bullet (can remain four physical lines):

> **Revise cap**: at most 2 author/reviewer revision pairs after the initial review; announce it first. At exhaustion, documents go to their user gate with every open item. For code, report open defects or make one bounded correction attempt, then independently review the changed code under §6. If that review finds defects, report them and stop automatic correction; do not reset the cap or claim completion.

This accepts the author's policy choice while providing a finite endpoint and retaining the shipping-code role, routing and evidence requirements. It does not allow taking over document authorship.

**R4 — P2: define renewed budgets without discarding prior rounds.** Evidence: `orchestration/references/checkpoints.md:39`, `:41`, `:47`. “Never reset” and “new automatic budget” currently cannot both be applied literally when a user authorizes more work after round 2. A fresh user-requested review must also not implicitly earn two more automatic pairs.

Replace “Resume these records; never reset the count” in step 3 with:

> Resume these records; continuation alone never resets the count.

Replace step 5 with:

> A user-requested revision gets a fresh review before the gate is shown again; that review alone does not reset the automatic-round count. A new automatic budget requires the user's explicit go-ahead or a user-requested scope change: retain the prior round history, record the reason, and start the new budget at round 0. Otherwise keep the current count and present the current verdict at the gate when the cap is exhausted. Questions that change nothing need no review.

**R5 — P2: exempt legitimately skipped artifacts, approvals and reviews together.** Evidence: `orchestration/references/team-leader-modes.md:14`, `:40`, `:43`. The new evidence check can otherwise block the existing BUGFIX flow before it creates batches.

Replace the new Mode 1/3 paragraph with:

> Mode 1 receives the plan, document reviews and recorded user gate decisions required by the selected flow, including open items the user accepted. Missing or stale required evidence is a blocker for you. Mode 3 checks that this evidence still applies and every batch has its required shipping-code review; it never commissions another document review. When the flow legitimately skips an artifact, its approval and review are also not required (for example, BUGFIX may enter Mode 1 directly after init).

### Recheck validation

Both anchors resolve: `checkpoints.md#cross-side-review-protocol` targets its heading at line 30, and `agent-catalog.md#document-review` targets its heading at line 93. All nine strategy validation steps have the review step. `agent-lanes/SKILL.md` is **219 lines**, within the ~230-line limit; the compact replacements above fit without moving the detailed protocol into that file. `git diff --check` passed for the plugin skills. Git commands were read-only; no source/mirror files were edited, no commit was made and no application tests were run. The earlier review content is preserved above.

## Round 2 recheck

**Verdict: APPROVED**

- **Author:** calling orchestrator, in-process author (as identified in the review request).
- **Reviewer:** this continuing CLI-lane review session.
- **Execution sides:** author — in-process; reviewer — CLI lane.
- **Reviewed revision:** the current working tree, inspected on 2026-09-23; limited to R1–R5 and contradictions introduced by their changes.
- **Completed revise rounds:** 2 (final automatic round).
- **Unresolved items:** none within this recheck's scope; no blocking or acceptable-with-disclosure findings remain.

Locations retain the plugin skill-root prefix defined in the original review.

1. **R1 — Closed.** `agent-lanes/SKILL.md:160` explicitly permits an independent, disclosed same-side reviewer when the user pins one, retains unavailable/disabled-side fallback, and prohibits silently replacing a pinned reviewer. `orchestration/references/lane-assignment.md:71` qualifies relay review routing; lines 104–106 identify the example as an explicit same-side override and retain subagent review as the default for CLI-authored work. The pinned roster now agrees with §6. Required disclosure is part of the implemented policy, not an unresolved review finding.

2. **R2 — Closed.** `orchestration/references/task-tracking.md:137` limits the initial gate sweep to the selected flow's requirements. Lines 139–140 exclude only document-review files from the QA row, leaving the enumerated code/visual review reports at line 151 eligible. Current-revision approval and earliest-unfinished-gate handling remain intact.

3. **R3 — Closed.** `orchestration/SKILL.md:9` now explicitly permits the bounded post-cap code correction and requires independent review before acceptance. `agent-lanes/SKILL.md:171` limits takeover to one correction attempt; a failed review requires reporting defects and stopping without resetting the cap or claiming completion. The shipping-code contract at line 153 continues to supply routing and review evidence. Documents still go to their user gate with open items at exhaustion. The deliberate exception is now consistent and finite.

4. **R4 — Closed.** `orchestration/references/checkpoints.md:40` preserves review state across continuation. Lines 46–49 distinguish a fresh review from a renewed automatic budget: only explicit user go-ahead or a user-requested scope change starts a new round 0, with prior history and the reason retained. Step 4 at lines 43–45 remains the exhaustion endpoint when no new budget is authorized. These rules no longer require both preserving and resetting the same active count.

5. **R5 — Closed.** `orchestration/references/team-leader-modes.md:40` makes Mode 1 evidence conditional on the selected flow; lines 43–44 exempt a legitimately skipped artifact's approval and review together. The explicit BUGFIX example agrees with direct Mode 1 entry at line 14. Mode 3 still checks applicable evidence and each batch's shipping-code review.

No new contradiction or dead end was found in these five edits. This approval is the independent review verdict; it does not replace the user's gate decision. No further automatic revision round is requested.

Validation: targeted reads of the changed clauses and their surrounding rules; `git diff --check` passed for plugin skills. `agent-lanes/SKILL.md` is **221 lines**, below the requested ~230-line limit. Only this review document was appended; previous sections were preserved. Git operations were read-only, no commit was made, and no application tests or mirror audit were performed for this narrowly scoped documentation recheck.

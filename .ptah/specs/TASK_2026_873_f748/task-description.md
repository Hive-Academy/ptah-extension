# Ptah Review — requirements

## Summary

Ptah Review automatically examines GitHub pull requests for configured, trusted repositories.
It runs first in Ptah Electron on a dedicated Ubuntu reviewer machine.
It polls PR heads, reviews changed code with deterministic checks and independent agent lenses,
verifies proposed findings, and publishes a walkthrough and a bounded GitHub review.
The pipeline retains per-head and per-finding state so new pushes get incremental follow-up.
A later phase supports an unattended headless CLI daemon on a VPS.
The initial repository is Hive-Academy/PtahCode.
This document specifies behavior and acceptance, not libraries, service layout, or screen design.

## Goals

- Catch significant correctness, async lifecycle, integration, security, and host parity defects before merge.
- Deliver a review on each eligible new PR head without requiring a user to start a chat session.
- Make every published finding traceable to code evidence and an attempted disproof.
- Give reviewers one current walkthrough, one review per run, and actionable follow-up across pushes.
- Measure recall and precision against the 108 CodeRabbit root findings on the 15 sampled PRs.
- Operate safely on a dedicated reviewer machine and later on a headless VPS.

## Non-goals

- Replacing human ownership of merge decisions or promising identical CodeRabbit wording.
- Executing fork PR code, PR-supplied setup scripts, or arbitrary commands from a diff.
- Hosting a public webhook endpoint in v1.
- Running as a GitHub Actions runner.
- Supporting GitLab, Bitbucket, or other non-GitHub forges in these phases.
- Auto-fixing, committing, or pushing changes to a contributor branch.
- Publishing GitHub check runs or blocking branch protection in the initial phases.
- Replacing existing CI, review commands, or the separately shipped quick-win PR #910.

## Users and scenarios

- A maintainer configures Hive-Academy/PtahCode and trusted authors, then leaves Electron running on Ubuntu.
- A trusted author opens a ready PR; the next poll starts a review and posts verified findings automatically.
- An author pushes a fix; Ptah examines the new commits, marks confirmed fixes addressed, and updates the walkthrough.
- The reviewer machine was offline for two days; restart discovers current open PR heads and reviews missing ones.
- A maintainer runs a dry-run replay or manual rerun and inspects stage outcomes without posting duplicates.
- A human disputes a comment; Ptah records the stated rule after validation and applies it to later reviews.
- A VPS operator later runs the same pipeline through a headless CLI daemon.

## Functional requirements

### FR-1 — Discover eligible PR heads

- Poll each configured GitHub repository for open PRs and current head SHAs at a configurable interval.
- Scope discovery by repository and explicit trust policy, independently of the currently open workspace.
- Treat a changed head SHA as a new review candidate.
- Distinguish draft, ready, closed, merged, forked, and untrusted PRs.
- AC-1.1: A new ready PR from an allowed author in an allowed repository is queued on the next successful poll.
- AC-1.2: A push that changes its head SHA creates exactly one new candidate for that SHA.
- AC-1.3: A draft PR is recorded but not reviewed or posted until it becomes ready; its current head is then queued.
- AC-1.4: Closed and merged PRs are not newly reviewed after discovery.
- AC-1.5: A failed GitHub poll is visible as a failed poll and retries later without advancing the discovery cursor.

### FR-2 — Persist review identity and catch up

- Persist review state by repository, PR number, and head SHA.
- Record discovery, queue, stage, publication, and terminal outcomes separately from cron job history.
- Enforce one active automated review per PR head and serialize publication for one PR.
- On startup, poll current open PR heads even when the scheduler's missed-slot window has expired.
- Preserve an audit record of skipped superseded heads while prioritizing the latest head.
- AC-2.1: Repeated polls, host restarts, and overlapping cron ticks do not create duplicate completed reviews for one head.
- AC-2.2: After 48 hours offline, an open PR whose current head is unreviewed is queued on startup.
- AC-2.3: A head superseded before publication cannot publish stale inline findings as current.
- AC-2.4: A crash during a stage leaves a recoverable state; a retry resumes or restarts safely without duplicate posts.
- AC-2.5: Run history shows repository, PR, head SHA, trigger, timestamps, and terminal result.

### FR-3 — Manual operation and safety controls

- Support a manual rerun for a selected PR head.
- Offer a global and per-repository publication kill switch and a dry-run mode.
- Manual reruns retain a distinct attempt record and reuse deduplication before publication.
- AC-3.1: A manual rerun can re-evaluate a reviewed head, reports its attempt ID, and does not duplicate unchanged GitHub findings.
- AC-3.2: With the kill switch active, discovery and dry-run analysis may continue but no GitHub mutation occurs.
- AC-3.3: Dry-run produces the same review artifact and publication preview without a GitHub write.
- AC-3.4: A switch changed during a run is checked again immediately before every attempted GitHub mutation.

### FR-4 — Build a walkthrough and triage map

- Produce a plain-language walkthrough of changed behavior, affected areas, and material risks.
- Include a sequence or data-flow diagram only where it clarifies an actual interaction.
- Triage PR size and risk before assigning review depth.
- Identify changed exports and likely consumers, including callers outside the diff.
- AC-4.1: Every completed review has a walkthrough and a risk map naming affected paths and reasons.
- AC-4.2: The walkthrough distinguishes observed code behavior from inferred risk.
- AC-4.3: An unchanged PR rerun does not create another walkthrough comment.
- AC-4.4: A new push updates the existing walkthrough comment in place and identifies the reviewed head SHA.

### FR-5 — Collect deterministic context

- Run the repository degradation audit and ESLint for changed files when applicable.
- Inspect dependents of changed exports and provide relevant callers to reviewers, including unchanged files.
- Record check command, scope, exit result, and truncated diagnostic evidence.
- Route every local check through `node scripts/verify.mjs --exec` so it acquires the machine-wide lock.
- Never turn an unavailable tool into a clean result.
- Use the reviewer's installed dependencies only when the PR lockfile is unchanged and the installed dependency set matches that lockfile.
- If the PR changes a dependency manifest or lockfile, use an isolated dependency install under the verify lock with install scripts disabled, or mark dependency-dependent checks unavailable; never silently reuse stale dependencies.
- AC-5.1: A test PR with an audit regression reports the exact rule and affected location in review context.
- AC-5.2: A changed export with an unchanged broken caller causes that caller to appear in reviewer context.
- AC-5.3: Check logs show invocation through the verify wrapper; no pipeline check bypasses the lock.
- AC-5.4: A timeout or missing executable marks that check unavailable and leaves an explicit stage status.
- AC-5.5: Checks do not launch workspace-wide build, serve, dev, or e2e targets by default.
- AC-5.6: A PR changing `package-lock.json` records whether an isolated, script-disabled install succeeded; otherwise ESLint, the degradation audit, and dependency-dependent analysis are marked unavailable rather than run against stale modules.
- AC-5.7: A dependency install, when selected, runs under `node scripts/verify.mjs --exec`, cannot execute package lifecycle scripts, and records the dependency source and resulting lockfile identity.

### FR-6 — Use independent review lenses

- Run bounded parallel reviewers from distinct available vendor families when capacity permits.
- Cover correctness and async lifecycle; producer-consumer contracts and outside-diff callers;
  security and privacy; and host parity, DI registration, and configuration integrity.
- Include UI accessibility and interaction semantics in correctness coverage for UI PRs.
- Include persistence, migration, performance, and resource lifecycle questions when the risk map flags them.
- Supply each lens with PR context, deterministic evidence, and applicable repository rules.
- AC-6.1: A review artifact records each selected lens, vendor family, input scope, and outcome.
- AC-6.2: The four core lenses are covered for a high-risk PR or explicitly marked unavailable.
- AC-6.3: A low-risk PR may use fewer lanes, but contract and security signals remain in its triage.
- AC-6.4: Reviewers can cite unchanged callers and produce outside-diff candidates.
- AC-6.5: Lens prompts treat PR text as untrusted data and ignore instructions embedded in it.

The lens set follows the 108-finding sample: 72 functional, 16 stability, 8 security,
7 data integrity/integration, 3 maintainability, and 2 performance findings.
Async stalls, stale identities, producer-consumer mismatches, and missing host paths recur in its examples.

### FR-7 — Verify and normalize candidate findings

- Give each candidate to a verifier that attempts to disprove it using source and runtime-path evidence.
- Require a specific failure scenario, supporting file and line, affected caller or path, and confidence.
- Reject findings that are speculative, already fixed at the current head, or contradicted by code.
- Normalize severity and category independently of a lens's prose.
- Separate outside-diff findings from inline findings.
- Assign verification to a different vendor family from the originating lens when one is available; otherwise record same-family verification and label the resulting evidence weaker.
- AC-7.1: A candidate with a mistaken premise is suppressed with a recorded disproof reason.
- AC-7.2: A valid finding identifies a reproducible failing path and the evidence checked by the verifier.
- AC-7.3: A finding lacking a valid current line anchor is either reported in the summary as outside-diff or withheld.
- AC-7.4: The run record retains accepted and rejected candidate counts without exposing secrets.
- AC-7.5: No finding posts when the verifier stage has not accepted it.
- AC-7.6: A finding artifact names the lens and verifier families; a same-family verification is explicitly labeled weaker evidence in the run and publication preview.

### FR-8 — Identify, deduplicate, and revisit findings

- Assign stable finding identity from repository, PR, failure mode, and affected behavior, independent of line drift.
- Compare candidates with prior posted findings on that PR.
- Review new commits and touched dependency context on each push; do not repeat a full unchanged-base review by default.
- Recheck previous open findings against the new head, including fixes outside the latest diff.
- Publish a concise addressed follow-up only after confirming the failure path is fixed.
- Preserve disputed and unresolved histories.
- AC-8.1: A line move without a behavior change does not create a second root finding.
- AC-8.2: A new bug in newly pushed commits can post once, even if earlier heads were reviewed.
- AC-8.3: A fixed finding receives one addressed follow-up explaining the changed behavior and evidence.
- AC-8.4: An unfixed finding remains open without an identical new root comment.
- AC-8.5: A later regression of a fixed issue is linked to prior identity and clearly marked as reopened.

### FR-9 — Format findings for humans and agents

- Use severities Critical, Major, Minor, and Nitpick with written criteria.
- Critical: immediate security, data-loss, or broad outage path; Major: material user-visible failure;
  Minor: bounded correctness or reliability defect; Nitpick: low-impact polish.
- Use categories matching the evaluation taxonomy, with a narrower optional subcategory.
- Include title, severity, category, file:line or outside-diff path, rationale, and code evidence.
- Include a suggested diff only when it is safe and directly supported.
- Include a `Prompt for AI agents` block with a concrete fix task and verification idea.
- AC-9.1: Every published finding has all required fields and a current evidence link or excerpt.
- AC-9.2: Suggested diffs compile conceptually against the current head and are omitted when uncertain.
- AC-9.3: Nitpicks are excluded from inline posting by default and may appear in a bounded summary section.
- AC-9.4: Severity labels have the same meaning in GitHub output, UI, and evaluation exports.

### FR-10 — Bound posting noise

- Publish only verifier-accepted candidates at or above the configured confidence and severity thresholds.
- Default proposal: confidence at least 0.8 and at most 10 new inline comments per review.
- Rank by severity, user impact, and evidence strength when the cap is reached.
- Report additional verified findings in a concise summary without hiding their count.
- AC-10.1: A run with 15 accepted inline candidates posts at most 10 inline comments at default settings.
- AC-10.2: Candidates below threshold are retained locally with suppression reasons and are not posted.
- AC-10.3: Changing thresholds affects future publications, not historical GitHub comments.
- AC-10.4: Reposting or editing a previously identified finding does not consume a new-finding slot.

### FR-11 — Publish a coherent GitHub review

- Auto-post to eligible PRs when publication is enabled; no default manual approval step.
- Upsert one walkthrough issue comment per PR on each reviewed push.
- Create at most one GitHub review containing that run's new inline comments and overview.
- Publish with a separately chosen identity and least needed permissions.
- Avoid secrets, local paths, credentials, and untrusted instruction text in posted output.
- Persist GitHub IDs and publication outcomes to make retries idempotent.
- Permit publication per repository during a transition in which CodeRabbit remains enabled; Ptah does not consume or react to CodeRabbit comments during live reviews.
- AC-11.1: A successful first review creates one walkthrough and at most one review.
- AC-11.2: A new push edits the same walkthrough comment and creates at most one new review.
- AC-11.3: A retry after a network timeout checks existing GitHub objects before creating replacements.
- AC-11.4: Publication is refused if the current PR head differs from the analyzed head.
- AC-11.5: Review publication uses comment semantics; it does not request changes or approve automatically.
- AC-11.6: A secret canary in test input is absent from preview, logs, and posted payloads.
- AC-11.7: Enabling Ptah publication for one repository leaves other repositories in dry-run and works while CodeRabbit also posts there; live Ptah state ignores CodeRabbit comments.

### FR-12 — Learn from human disputes

- Detect human replies and dismissals on Ptah finding threads.
- Distinguish disagreement from simple resolution or a bot's own reply.
- Store a learning with scope, rationale, source link, and reviewable status.
- Apply accepted learnings to later reviews of the applicable repository.
- Do not let an untrusted PR author or injected comment silently weaken security checks.
- AC-12.1: A human dispute is surfaced as a candidate learning with its original finding and reply.
- AC-12.2: A confirmed repository rule suppresses a matching later candidate with an auditable reason.
- AC-12.3: A resolved thread without a stated dispute does not become a rule.
- AC-12.4: A learning can be revoked and stops affecting subsequent reviews.
- AC-12.5: Critical security findings require explicit trusted-maintainer validation before suppression.

### FR-13 — Configure repositories and runtime

- Provide a versioned per-repository config file analogous to `.coderabbit.yaml`.
- Support include/exclude paths, path-specific instructions, lens toggles, and minimum severity.
- Provide app settings for repositories, polling, dry-run, kill switch, trust policy, and lane budgets.
- Validate configuration and show effective settings for a run.
- Treat configuration read from a PR branch as untrusted until its source is trusted.
- AC-13.1: A config excluding `.ptah/specs/**` omits those paths from review scope.
- AC-13.2: A path instruction affects only matching paths and is visible in the run artifact.
- AC-13.3: Invalid config blocks publication for that repository and reports the exact key and error.
- AC-13.4: App-level kill switch overrides repository publication settings.
- AC-13.5: Configuration changes are applied on the next run without losing past run provenance.

### FR-14 — Budget lanes and contain failures

- Limit concurrent PR reviews and lanes per PR; set depth by PR size and triaged risk.
- Consult lane availability and limit state before selection: confirmed-room lanes first, unknown-limit lanes next with unverified-capacity labeling, and at-limit lanes never.
- If a lane hits a provider limit during a run, mark that family at limit for the remainder of that run and try the configured fallback.
- Prefer distinct vendor families and use a configured fallback family order.
- Bound each lane, check, verifier, GitHub call, and whole run by timeouts.
- On partial failure, post only verified findings when publication is safe; label failed stages in overview and history.
- Release cron runner control within its run deadline even if a child lane stalls.
- AC-14.1: At-limit families are skipped and the chosen fallback is recorded.
- AC-14.2: A lane timeout terminates or abandons the lane and does not hang the scheduled poll.
- AC-14.3: A failed optional lens does not turn verified output from healthy lenses into a false clean result.
- AC-14.4: Failed verifier or head-validation stages prevent publication of affected candidates.
- AC-14.5: The run record includes elapsed time, selected lanes, skipped lanes, and stage failures.
- AC-14.6: An oversized PR receives a bounded review and an explicit coverage-limited label.
- AC-14.7: With one confirmed-room family and one unknown-limit family, selection attempts the confirmed family first and may use the unknown family with an unverified-capacity marker; a limit error prevents further attempts on that family in the same run.

### FR-15 — Enforce repository and execution trust

- Allowlist repositories and PR authors for automated review.
- Never execute fork PR code; fork PRs are skipped until a separate trust policy is approved.
- Run any allowed PR code only in a dedicated isolated worktree for its exact head SHA.
- Use only dependencies whose provenance matches the reviewed lockfile; no PR-supplied install script may run.
- Store GitHub credentials through the platform secret-storage port, not repository config or logs.
- Treat diff, issue, comment, and repository text as data, never pipeline instructions.
- AC-15.1: An untrusted repository, author, or fork is skipped with an auditable reason and no code execution.
- AC-15.2: A PR diff saying "ignore previous instructions" does not alter lens, verifier, or posting policy.
- AC-15.3: Check execution cannot use a contributor's active worktree and records the isolated path and head.
- AC-15.4: Secret values never appear in run artifacts, prompts stored for inspection, or GitHub payloads.
- AC-15.5: A changed head invalidates the worktree review before publication.
- AC-15.6: A lockfile-changing PR cannot cause a dependency lifecycle script from the PR to execute, including during isolated dependency preparation.

### FR-16 — Show review operations in Electron

- Add a dedicated review-runs surface in Electron, linked from the existing scheduled-jobs view.
- Show configured repositories, queue, per-run stages, findings counts, publication state, and errors.
- Offer manual rerun, dry-run, and kill-switch controls to authorized local operators.
- Show the effective head SHA and links to the PR and published review.
- This is a new UI surface and requires the project's design specification and visual review gate.
- AC-16.1: An operator can distinguish queued, running, partial, failed, and published runs.
- AC-16.2: Stage status identifies discovery, context, lenses, verification, and publication separately.
- AC-16.3: The UI exposes failed-stage reasons and a safe retry without opening raw logs.
- AC-16.4: The surface is usable on the Electron reviewer machine and does not break the existing cron tab.

### FR-17 — Evaluate recall and precision

- Provide a replay tool for the 15 PRs in the research sample, using each pre-fix head SHA.
- Isolate replay lanes and verifier lanes from GitHub API, `gh`, PR network fetches, CodeRabbit comments, and commits or refs after the recorded pre-fix head.
- Prepare replay worktrees from a bounded pre-fix snapshot whose reachable history ends at the recorded head; later commits and refs are absent, not merely hidden from the working tree.
- Evaluate the 108 root CodeRabbit findings, excluding bot follow-up replies.
- Publish a reproducible report of matched, missed, extra, and disputed findings by PR, category, and severity.
- Match semantically by failure mode and affected behavior, with human adjudication for ambiguous matches.
- Report precision against manually adjudicated actionable Ptah findings; CodeRabbit absence alone is not a false positive.
- Proposed switch-off gate: at least 75% recall overall and at least 85% recall on Major findings,
  with at least 70% adjudicated precision, across the fixed 15-PR sample.
- The gate is a proposal for user approval, not a commitment that CodeRabbit may be switched off automatically.
- AC-17.1: Replay checks out the recorded pre-fix head, not the merged or post-fix state.
- AC-17.2: The report denominator remains 108 roots and 31 Major findings unless adjudication records a correction.
- AC-17.3: Every match links the Ptah finding and reference root with an adjudication note.
- AC-17.4: Re-running on the same inputs yields the same denominator and traceable changes in scores.
- AC-17.5: The report explicitly shows performance against the proposed switch-off gate.
- AC-17.6: In replay, a lens or verifier cannot call `gh`, reach GitHub or another PR-answer endpoint, or read a commit or ref after the pre-fix head; an attempted access fails and is logged.
- AC-17.7: The report records the replay snapshot identity, reachable-commit bound, network and credential isolation method, and any isolation failure; a failed isolation invalidates that replay score.

## Non-functional requirements

- NFR-1: Core pipeline behavior is host-neutral; Electron is the first runtime and CLI daemon is the later runtime.
- NFR-2: Preserve the existing `platform-cli` and `cli-engine` behavior during Electron integration.
- NFR-3: Persist state transactionally enough to recover after process termination or power loss.
- NFR-4: Bound polling, queue size, lane concurrency, check execution, and GitHub retries.
- NFR-5: Use least-privilege GitHub credentials and redact secrets before storage or publication.
- NFR-6: Surface partial coverage honestly; unavailable lanes and checks never imply success.
- NFR-7: Protect the reviewer machine's active workspace and verification capacity.
- NFR-8: Keep run artifacts and GitHub writes attributable to repository, PR, SHA, and attempt.
- NFR-9: Follow existing module boundaries and host adapters without importing Electron into shared backend logic.
- NFR-10: Make all publication and learnings changes auditable and reversible where GitHub permits.
- NFR-11: Proposed latency target for a ready PR under 1,500 changed lines at default depth: publish its walkthrough within 10 minutes and its review within 30 minutes of detecting the new head, when GitHub and selected lane providers are available. Record discovery, queue, walkthrough, and review timestamps; report p50/p95 latency and target misses by cause.

## Phasing

### P1 — Local pipeline, dry-run, and evaluation

- Electron polls trusted PRs and records per-head state; no GitHub mutations.
- Build isolated review context, deterministic checks, lens review, verifier, and dry-run artifact.
- Add the Electron review-runs surface and complete its design gate.
- Keep the core pipeline operable before and without the UI through persisted artifacts on disk and cron run history, so UI design work does not block evaluation.
- Replay the 15 pre-fix heads and produce initial recall and precision report.
- Independently shippable as a local reviewer with dry-run output and measurable coverage.
- P1 acceptance includes reviewing and exporting a replay result with the Electron review-runs surface unavailable.

### P2 — Automatic publication and incremental review

- Enable trusted-repository GitHub publication after identity and credential decisions.
- Allow per-repository rollout while CodeRabbit continues posting; live Ptah reviews ignore CodeRabbit comments.
- Upsert walkthrough, post one bounded review per run, deduplicate, and follow up on fixes.
- Handle new pushes, outage catch-up, kill switch, and idempotent retry.
- Independently shippable as the first unattended CodeRabbit alternative on Electron.

### P3 — Learnings and tuning

- Capture human disputes, validate learnings, apply scoped rules, and expose revocation.
- Tune path instructions, thresholds, lane depth, and evaluation against observed errors.
- Independently shippable as review quality improvement without changing P2 posting guarantees.

### P4 — Headless VPS daemon

- Run the same host-neutral pipeline as a persistent CLI daemon on a VPS.
- Provide startup, shutdown, health, secret storage, and restart recovery for unattended operation.
- Keep Electron UI optional for inspecting the same review records.
- Independently shippable for operators who need review while desktop Electron is closed.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Classify as FEATURE with full review depth | FEATURE / DEVOPS | New review behavior, state, GitHub integration, lanes, UI; task decisions D1 | Yes |
| Poll PR heads through scheduled handler jobs in v1 | Poll / webhook / Actions | D5; `job-runner.ts:250-259` accepts `handler:`; no PR event trigger | Yes |
| Maintain review state independent of cron runs | Separate state / reuse cron slot | `0004_cron.ts:18-29` keys a run by job and slot, not PR SHA | Yes |
| Rediscover current heads on startup | Full PR reconciliation / cron slot replay only | `catchup-coordinator.ts:87-103` caps window and selects last slot | Yes |
| Use unattended lane process API | AgentProcessManager / chat child session | D6; `agent-process-manager.service.ts:409-450` supports programmatic spawn | Yes |
| Use dedicated Electron review-runs surface | New surface / extend cron tab only | Review needs per-PR SHA, stage, finding and publication state beyond cron run summary | Yes |
| Review ready PRs; defer drafts | Review drafts / defer drafts | Draft means author has not requested review; readiness transition can be polled | Yes |
| Default to comment-only reviews | Comment / request changes / approve | Automated verifier and partial failures should not set merge authority | Yes |
| Route local checks through verify wrapper | Wrapper / direct Nx tool | `scripts/verify.mjs:11-19` defines machine-wide lock | No, while lock policy applies |
| Keep fork PRs out of execution | Skip / execute trusted forks | Fork code plus write credentials creates an unapproved trust boundary | Yes, by future policy |
| Use one current walkthrough per PR | Upsert / append on every push | CodeRabbit walkthrough and user requirement; avoids feed noise | Yes |
| Stage VPS daemon in P4 | P4 / first release | Binding Electron-first user decision D3 | Yes |
| Isolate replay from later answers | Bounded pre-fix snapshot / ordinary checkout | Sample PRs already contain CodeRabbit comments and later fixes; ordinary history or network access contaminates recall | No, for valid benchmark scores |
| Handle changed lockfiles without scripts | Isolated script-disabled install or unavailable checks / stale dependency reuse | ESLint and audit require installed dependencies; PR manifests can introduce executable lifecycle scripts | Yes, within trust policy |
| Attempt unknown-limit lanes after confirmed capacity | Confirmed then unknown / treat unknown as unavailable | Reviewer machine has unknown limit reads; cross-family coverage otherwise degrades | Yes |
| Prefer cross-family verification | Different family / same-family only | Independent disproof reduces correlated lens errors; availability can force a labeled fallback | Yes |
| Roll out alongside CodeRabbit per repository | Parallel rollout / immediate replacement | Benchmark gate is proposed and CodeRabbit remains on during measurement | Yes |

## User-Reserved Decisions

- **GitHub publishing identity and credential authority.** Options: dedicated bot account with narrow repository token (Recommended); GitHub App installation; user's own token. The bot account is simple for the first repository, while a GitHub App may scale better; the user's personal token makes attribution and rotation less clear. User must choose before P2 writes.
- **Trusted repository and author set.** Options: Hive-Academy/PtahCode plus explicit maintainer allowlist (Recommended); all org members; any public PR author. User must name the initial allowlist and who can change it before unattended posting.
- **Money and usage cap.** Options: fixed per-PR and monthly spend ceilings with stop-and-report (Recommended); provider quota only; uncapped. User must set amounts and accepted fallback behavior before unattended lanes incur spend.
- **CodeRabbit switch-off threshold.** Options: approve the proposed 75% overall/85% Major recall and 70% precision gate (Recommended for initial trial); set stricter numbers; retain CodeRabbit regardless. Benchmark results inform the final decision; no automatic switch-off.
- **Outward-facing review tone and notification scope.** Options: neutral comment-only reviews in GitHub (Recommended); request-changes reviews; add external messaging. The binding auto-post decision covers GitHub publication, while escalation and external destinations need separate approval.

## Risks

- **False positives at scale:** verifier disproof, confidence floor, comment cap, adjudicated precision report, and reversible learnings.
- **Missed defects:** multiple lenses, outside-diff callers, deterministic checks, and category-level recall tracking.
- **Stale or duplicate comments:** head check immediately before posting, stable finding IDs, GitHub ID reconciliation, and serialized PR publication.
- **Offline reviewer machine:** startup reconciliation of current heads; P4 daemon for always-on deployments.
- **Provider quota or lane failure:** limit-aware selection, cross-family fallback, timeouts, and labeled partial coverage.
- **Verification resource pressure:** scoped checks only and mandatory `verify.mjs --exec` lock.
- **Prompt injection and credential exposure:** trusted inputs, isolated worktree, secret-storage port, redaction, and publication preview checks.
- **Human disagreement poisoning learnings:** trusted-maintainer validation, scoped rules, provenance, and revocation.
- **Benchmark overfitting:** report per-category results and adjudicated extra findings; validate later on fresh PRs before switch-off.

## Open questions

- Which GitHub identity, initial trust allowlist, and spending ceilings will the user authorize for P2?
- Will the user approve the proposed benchmark thresholds after reviewing replay results?
- Which specific provider families have stable capacity on the reviewer machine at deployment time?
- What retention period should apply to local prompts, lane output, and review artifacts?
- Should a future phase support a secure webhook or non-GitHub repository host?

## Revision log

- Finding 1: FR-17 and AC-17.6–17.7 require bounded pre-fix replay snapshots, network and credential isolation, and evidence in the report; Decisions records the benchmark rule.
- Finding 2: FR-5, AC-5.6–5.7, FR-15, and AC-15.6 define dependency provenance, isolated script-disabled installation, and unavailable-check behavior.
- Finding 3: FR-14 and AC-14.7 define confirmed/unknown/at-limit ordering; FR-7 and AC-7.6 label same-family verification.
- Finding 4: NFR-11 proposes measurable walkthrough and review latency targets.
- Finding 5: P1 requires disk artifacts and cron history to support evaluation without the new UI.
- Finding 6: FR-11, AC-11.7, and P2 define per-repository parallel rollout with CodeRabbit.

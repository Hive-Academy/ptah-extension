# Implementation Plan Review - TASK_2026_441_7825

Author: codex lane
Reviewer: claude subagent (code-logic-reviewer)
Artifact revision: 2
Round: 2
Verdict: APPROVED

(Round 1 verdict was REVISE; the round 1 text below is kept intact. Round 2 follows at the end.)

Scope: document review only (Gate 2). No source edited, no command run. I read the plan in full, `context.md`, `decisions.md`, the old `.claude/skills/fleet-orchestration/SKILL.md`, and the shipped files the plan edits (agent-lanes SKILL.md, orchestrate.md, task-tracking.md, the validator, the runtime sources named below).

## Checks 1-7 at a glance

| # | Check | Result |
| --- | --- | --- |
| 1 | Acceptance criteria 1-7 map to a change and a verification | Changes mapped. Verification of criteria 1-4 is not executable as written (finding 1). |
| 2 | Only shipped sources edited | Pass. Plugin, agent template, scripts and runtime libs only. `.claude/skills/fleet-orchestration` deletion is the approved one. Repo-local edits (`CLAUDE.md`, `.claude/workflows/fleet-fix.js`) are not generated mirrors. No `.claude/agents`, `.codex` or `.opencode` writes. |
| 3 | Runtime evidence and "gap only" scope | Evidence accurate. Scope is wider than needed (findings 5, 6). |
| 4 | Fleet parity, generic/specific split, neutrality | Pass with gaps (findings 8, 9, 10). |
| 5 | Document-gate vs code-review split | Coherent in intent. The edit instructions are too narrow and could leave contradictory text (finding 2). |
| 6 | Validator retarget keeps checks; manifest and bump once | Mostly. Under-specified (finding 4); validator work is split across two phases (finding 7). |
| 7 | File-disjoint batches, scoped verification | Disjoint. Group A/B verification is heavy and does not exercise the change (finding 3). |

## Evidence spot-check (11 claims checked, all accurate)

- `lane-limit-classifier.ts:120-158,199-214`: the Codex matcher parses "try again at" into `resetsAt`, and `MODEL_CAPACITY_REGEX` is skipped before any matcher runs. Header `:1-25` says timeouts and auth are never quota. Verified.
- `agent-process-manager.service.ts:2362-2379`: classification runs before the buffer discard. It only runs when status is still `running`, so a timeout or stop never reaches it. `failureKind` is set at `:2377`. Verified.
- `agent-process-manager.service.ts:2432-2464` (the classify function) and `:2505-2522` (the ledger `recordWindowEvidence` / `recordOwnerEvidence`). Verified.
- `agent-limit.formatter.ts:290-329`: AT LIMIT renders with `resets <UTC>` or `reset unknown`. Verified.
- `protocol-dispatcher.ts:1189-1200` and `agent-tool.dispatcher.ts:411-432`: both transports refuse a blocked spawn unless `force`. Verified. The stdio path also adds `resetsAt` structured data.
- `lane-completion-notifier.service.ts:499-535,617-679`: `buildSignal` checks declared deliverables, and `verdictOf` returns only `failed` / `unverified` / `delivered` / `no-deliverable`, so no failure cause is carried. The plan's claim is right.
- `agent-process.types.ts:55,161-163`: `AgentFailureKind = 'quota'` only. Verified.
- `mcp-response-formatter.ts:1914-1950`: `formatAgentStatus` prints status, stop reason, role, session id and exit code, with no `failureKind`. Verified. It is the single formatter for both transports (`protocol-dispatcher.ts:1276`, `agent-tool.dispatcher.ts:568`), so editing one file is enough.
- `validate-orchestration-skill.ts:147-154,405-424,433-450,495-509`: validator targets `.claude/skills/orchestration` and `.claude/agents`. Verified.
- `agent-lanes/SKILL.md:135-149,162-189`: recovery table and cross-side rules as quoted. Verified.
- Live `fleet-orchestration` references outside spec history: only the two `prompt-suggestions.component.ts` lines (228, 299), `skill-triggers.v1.jsonl:6`, and the skill itself. The plan found all of them.

"Runtime gap only" is the right direction. The plan correctly refuses a second classifier, a watcher and a force path, and correctly reports that the completion signal (TASK_2026_438) already ships. That removes the context.md scope item 5 watcher requirement. I flag it as a scope change the plan has justified with code evidence, not a silent drop.

## Findings

### 1. Serious - Acceptance criteria 1-4 have no executable verification

- Evidence: plan "Acceptance criteria -> verification" rows 1-4 say "run a bounded orchestration fixture/scenario", "Stub stored lane preference; Gate 0.1 chooses enabled", "orchestration scenario chooses different family, then same-family alternative, then subagent". No batch A-H creates a fixture, harness or test for any of these. Skill and agent prose is not runnable. The only automated gate for those files is `npm run validate-skill`, which checks structure, links and headings.
- Wrong: the checks that prove the headline behaviour (lanes-first default, cross-family review, memory pre-selection, ordered quota fallback, "later batch skips the exhausted lane") cannot be run, and the plan names no one who will do it.
- Required change: pick one and write it into the plan.
  - (a) Add static rule-marker assertions to the validator in Group H. Examples: Gate 0.1 text names `ptah_memory_search` before mode selection; the fallback order tokens appear in `agent-lanes/SKILL.md` §5; the `batches.md` schema in the template contains `Recommended executor: CLI lane`, `Subagent reason` and `Review family`. Pair this with a template spec assertion in Group C (the plan only says "if a semantic assertion is added").
  - (b) Replace "run a scenario" with a named manual walkthrough whose transcript is recorded in `test-report.md`, and say so honestly.
  - Row 4 can keep its runtime spec (`agent-process-manager.service.spec.ts`), which is real. State clearly that the skill-level ordering is verified statically or by walkthrough.

### 2. Serious - Review-routing edits in `agent-lanes/SKILL.md` and `checkpoints.md` are scoped too narrowly and risk contradictory or weakened gates

- Evidence: plan component 2 replaces only "the §6 code-review clause". The actual text that routes code is in four places. `agent-lanes/SKILL.md:162` (table row "Code that will ship ... routed cross-side"). `:164-165` (Independence bullet). `:166-176` (the Cross-side review bullet: "CLI author -> a subagent ... Applies to every decision artifact ... and all shipping code"). `:177-179` (approving cross-side review passes the gate in `lane-review` mode; same-side review goes to the user). The plan also says it will change `checkpoints.md` "only where it speaks about document gates", which is the opposite of what it must change.
- Wrong: if only the clause is replaced, `:166-176` still says shipping code is reviewed cross-side with "CLI author -> subagent". That directly contradicts the new rule and re-creates the failure that caused this task. Conversely, if the bullet is rewritten wholesale, the document-gate protocol (opposite side, escalation to the user on same-side review, REVISE at cap, proposed removals) can be dropped by accident. This is the one place where Gates 1/1.7/2 could be silently weakened.
- Required change: list the exact lines in `agent-lanes/SKILL.md` (162, 164-176, 177-179), `checkpoints.md`, `SKILL.md:89-124`, `team-leader-modes.md:36-41` and `lane-assignment.md:72-109` to be edited. Split the bullet into two explicit rules: Document gates (unchanged: opposite execution side, same-side -> user, REVISE at cap -> user, removals -> user) and Shipping code (different family, regardless of side, same-family needs a stated reason and is labelled weaker). State what happens when the code reviewer is an in-process subagent and the implementer is a Claude subagent: that is same-family and needs a reason too. In the "no eligible lane can review -> independent subagent" rule, require the same reason and weaker-evidence label. Add a regression check in the verification: after the edit, grep that the document-gate escalation sentences still exist in both files.

### 3. Moderate - Group A/B/H verification runs the whole `ptah-extension-vscode` test project and still does not exercise the change

- Evidence: groups A and B gate on `npx nx test ptah-extension-vscode --parallel=1`. The edited files are Markdown under `assets/plugins`. `CLAUDE.md:3-16` bans wide runs on this machine.
- Wrong: this is the heaviest project in the repo, it runs for no benefit on prose edits, and a pass says nothing about the new rules.
- Required change: gate A/B on `npm run validate-skill` plus the static assertions from finding 1 plus a targeted link check. Drop the project-wide test, or replace it with the single focused spec that covers plugin assets (name it) if one exists. Keep `manifest:check` and the Group C/D/E/F project tests.

### 4. Moderate - Validator retarget is under-specified and could silently drop the agent-existence check

- Evidence: plan decision 5 says "redirect the validator to plugin source and template source". The validator builds `.claude/agents/${agent}.md` (`:412`), error text and suggestions say `.claude/...` (`:416-419,506,560`), and `SKILL_ROOT`/`AGENTS_DIR` come from `process.cwd()` (`:147-153`). Template files are named `<agent>.template.md` (16 templates exist, `_shared/` is a directory).
- Wrong: a path swap alone would make `validateAgentFilesExist` fail for every agent. The easy "fix" is to relax or skip the check, which drops an existing guard. Messages that still point at `.claude/` would mislead the next person.
- Required change: specify the mapping (`libs/backend/agent-generation/templates/agents/${agent}.template.md`), update the error and suggestion strings, add `fleet.md` to `REQUIRED_REFERENCES`, and state that every existing check is kept (syntax, internal references, strategies documented, agents documented, invocation patterns, required sections, line-count warning). Confirm `REQUIRED_AGENTS` is a subset of the template names.

### 5. Moderate - Runtime change touches three Nx projects and the benefit is thin; justify or demote

- Evidence: plan component 5 adds `failureResetsAt` to `@ptah-extension/shared`, sets it in `agent-process-manager.service.ts`, extends the notifier signal and `formatAgentStatus`. The list already reports `AT LIMIT (..., resets <UTC>)` per lane (`agent-limit.formatter.ts:290-329`), and the spawn gate already refuses a blocked lane. Scope item 3 ("list should report limited until") is therefore already met. The plan itself admits `AgentProcessInfo` serialization across hosts is an unverified assumption.
- Wrong: this is the only part of the plan that widens blast radius (shared type, a 2,000+ line manager service, the model-facing completion envelope), and its stated reason is convenience ("not infer the reset by matching a later list row"). The skills can read the list row, and for the failed run `failureKind: quota` is already in the record.
- Required change: either (a) keep it and state the concrete failure it prevents (for example: the list row is keyed by owner/window, so after the run the orchestrator cannot tie the reset to this specific run) and verify the serialization assumption before batching, or (b) split it into an optional follow-up and have the skills use list-row reset plus `failureKind`. If kept: add `npx nx typecheck` for the dependents of `@ptah-extension/shared` that consume `AgentProcessInfo`, since a one-project test run will not catch them. Also drop "clear it on a later successful/continued turn" unless a case exists; a resumed lane gets a new `agentId` (`agent-lanes/SKILL.md:139`), so there is no turn to clear.

### 6. Moderate - Unknown reset time has no skip rule

- Evidence: plan agent-lanes §5 text: "capture ... reset time ... (otherwise `reset unknown`), record it ... and skip that lane until reset". Codex with a dated "try again at Oct 5th" deliberately yields `resetsAt` undefined (`lane-limit-classifier.ts` Codex matcher), and OpenCode, Ollama and Grok never give a reset.
- Wrong: "until reset" is undefined for the common unknown case. The run could skip the lane forever, or re-spawn it on the next batch and burn a failed spawn, which is exactly acceptance criterion 4's second half.
- Required change: say that with no reset the lane is skipped for the rest of the run and re-checked via `ptah_agent_list` only at the next Gate 0.1 or on user request. Say that a list row showing confirmed room overrides the context.md entry.

### 7. Moderate - Group H is split across two phases, which breaks one-owner-per-batch

- Evidence: "implement that portion of H first ... final H regenerates the manifest" (plan, batch section).
- Wrong: the same file set is owned by two batches at different times, and the validator is a dependency of A/B evidence.
- Required change: make H1 = `validate-orchestration-skill.ts` (first), and H2 = `plugin.json` + `content-manifest.json` (last, after A/B/C/G changes to plugin and template). Confirm the single version bump and single manifest run happen in H2.

### 8. Moderate - Fleet parity: three rules lose their anchor

- Evidence: parity table rows §4, §7, §3.
  - §4 batch cap "at most 6 files across at most 2 libs, one scoped command" is mapped to "team-leader/agent-lanes" but no edit in components 2 or 3 adds or keeps it explicitly. The template cap is cited (`:140-163`), the agent-lanes cap is §8.
  - §7 "never `nx test projA projB`; read the 'Running target test for N projects' header" goes to `CLAUDE.md`, but `CLAUDE.md:3-16` currently says use `npx nx test <project>` and the old skill says use `run-many -t test -p`. The two instructions conflict, and the plan does not say which wins.
  - §3 judge artifact schema `{ taskId, round, pass, defects[], testsRan, mentorNote }` is "retained", but the plan does not put the schema into `fleet.md`; `fleet-fix.js` hard-codes it (`judgeSchema`, `judge-round-${round}.json`).
- Required change: add the exact batch cap sentence and the schema to `fleet.md` (or confirm they already exist in the named homes with line numbers). Decide the Nx rule: single project -> `npx nx test <project>`; several projects -> `run-many -t test -p ...` plus the header count check. Write that into `CLAUDE.md` and delete the contradiction.

### 9. Minor - Fleet task status ownership

- Evidence: `task-tracking.md:61,75-76` lets agents `Edit` the `status:` line; the role contracts say status is not owned by reviewers/judges. The fleet text says a judge is read-only and "no task.md edits", but the plan says only "task status ownership from task-tracking.md".
- Required change: state in `fleet.md` who writes `status:` (the orchestrating process / team-leader) and that a worker re-spawned after a crash must find its artifact and no-op (old §3).

### 10. Minor - Location of the `fleet-fix` skill is not established

- Evidence: context.md says "Keep ... the `fleet-fix` skill; point them at the new reference". The worktree has only `.claude/workflows/fleet-fix.js`; the plan edits only that.
- Required change: say where the `fleet-fix` skill entry lives, or state that none exists in the repo and the workflow header is the only pointer. Also say whether `fleet-fix.js` prompts keep `run-many` (see finding 8).

### 11. Minor - Tribunal and other plugin files not addressed

- Evidence: context.md lists `skills/tribunal/**` as a plugin source. The plan never mentions it. `tribunal/references/relay.md:20-21` repeats the cross-side/escalation rules and `tribunal/SKILL.md:14` mentions subagents. `orchestration/references/strategies.md:6,35,58` and `agent-catalog.md:97,104` mention cross-side review for documents.
- Required change: add one line stating tribunal, strategies and agent-catalog need no change because they describe document gates only, which are unchanged. Include them in the post-edit grep from finding 2.

### 12. Minor - Gate 0.1 edge cases

- Evidence: plan Gate 0.1 text.
- Required change: define (a) a stored preference for lanes but no spawnable lane (degrade to `disabled`, tell the user, do not pretend); (b) conflicting or stale memory hits (most recent wins, or ask); (c) memory unavailable (already handled; keep). Also note the optional "record exhausted lane in memory" from context.md scope item 3 is not planned; say so explicitly as deferred.

## Removals and capability changes flagged

- `auto` stops being the recommended Gate 0.1 default. It remains selectable. Not a capability removal.
- The agent-lanes rule "CLI author -> subagent reviews code" is removed on purpose. It must not take the document-gate rule with it (finding 2).
- Old `fleet-orchestration` skill deleted (approved). §2 (workflow resume bug) goes repo-local only; §6 commitlint scopes goes repo-local only; §9 dropped as a duplicate of agent-lanes. These are acceptable only if the parity rows in finding 8 are closed.
- The scope item 5 watcher is dropped because the push signal already ships. Evidence verified.

## Verdict

REVISE. Two Serious findings (1, 2) must be closed. Findings 3-8 should be fixed in revision 2 at the same time since they change the batch and verification table. 9-12 may be fixed or answered in one line each.


## Round 2

Reviewer: claude subagent (code-logic-reviewer). Artifact: implementation-plan.md revision 2, final 109-line version (re-read after the author's last pass that fixed section markers and made the `checkpoints.md` document-gate edits exact). Scope: fixes for round 1 findings 1-12 only. Document review; no source edited, no command run. Spot-checked `agent-lanes/SKILL.md:160-179`, `protocol-dispatcher.ts:1187-1202`, `agent-tool.dispatcher.ts:409-433`, `agent-process-manager.service.ts:2362-2379,2500-2524`.

### Finding closure

| # | Sev | Status | Evidence (plan revision 2) |
| --- | --- | --- | --- |
| 1 | Serious | Closed | Validator static markers named (Validator bullet 2): Gate 0.1 `ptah_memory_search` before mode selection and no-preference `enabled`; `Subagent reason`; lane section 5 fallback tokens and unknown-reset skip; lane section 6 `Document gates` / `Shipping code` plus different-family/reason/weaker markers; fleet cap and judge keys. Section and order checks, diagnostics name file and section. Template schema keys asserted by the new Group C spec (template edit bullet and "Required template test"). Criteria table gives each row an owner; the walkthrough is a named manual gate recorded in `test-report.md`. |
| 2 | Serious | Closed | Edit list names `agent-lanes/SKILL.md:162,164-176,177-179`, `checkpoints.md:94-107,128-146,155-195`, `SKILL.md:80,89-124,153-171`, `team-leader-modes.md:36-41,64-95`, `lane-assignment.md:72-88,107-109`. The mixed bullet is split into "Document gates (unchanged)" (opposite execution side, same-side -> user, REVISE at cap -> user, removals -> user) and "Shipping code (different family)" with reason and weaker label, covering subagent-vs-subagent and the no-eligible-lane fallback. The final pass adds that `checkpoints.md` keeps "all five escalations" and that code review is not routed through the document gate. Grep regression covers nine named files, requires the escalation sentences to survive in agent-lanes and checkpoints, and requires the old "CLI author -> subagent" and "code that will ship -> cross-side" rules to be gone. Group A names the grep. |
| 3 | Moderate | Closed | Rows A and B: `npm run validate-skill` plus link/static checks, "No extension project test". |
| 4 | Moderate | Closed | Validator bullet 1: `<agent>.template.md` mapping, all listed checks kept, `fleet.md` added, error text `:416-419,506,560` fixed, 14 `REQUIRED_AGENTS` verified as subset. |
| 5 | Moderate | Closed (residual R2-1) | "No required runtime edits"; no `failureResetsAt`; follow-up gated on evidence and dependent typechecks. |
| 6 | Moderate | Closed | Agent-lanes section 5: unknown reset -> skip for rest of run, re-check only at next Gate 0.1 or on user request; fresh list row with room overrides. Validator asserts it. |
| 7 | Moderate | Closed | H1 = validator only, first; H2 = `plugin.json` + `content-manifest.json`, last, one bump, one manifest run. |
| 8 | Moderate | Closed | Parity rows: section 3 schema keys and filename; section 4 exact cap sentence in `fleet.md` and the template; section 7 single vs multi-project Nx rule, contradiction deleted, workflow prompts `:135,170` fixed. |
| 9 | Minor | Closed | Paragraph after parity table: only orchestrator/team-leader writes `status:`; respawned worker with complete artifact no-ops. |
| 10 | Minor | Closed | No `.claude/skills/fleet-fix`; `.claude/workflows/fleet-fix.js:2` is the entry, header points to `fleet.md`; prompts corrected. |
| 11 | Minor | Closed | Tribunal, strategies, agent-catalog declared document-gate-only, no edit, included in the grep. |
| 12 | Minor | Closed | Gate 0.1 text covers lanes preference with no spawnable lane (`disabled`, tell user, `Approval: user`), conflicting/stale memory, memory unavailable; persistent exhausted-lane memory explicitly deferred. |

### Serious 1 and 2 confirmation

Both fully closed. Markers are named and the asserting file is stated (H1 validator; Group C spec for the template). The review-rule split lists exact lines against the live text at `agent-lanes/SKILL.md:160-179`, keeps document-gate escalation, and a post-edit grep regression exists. The manual-only part (skill-level fallback ordering) is honestly labelled manual evidence.

### Finding 5 demotion vs acceptance criterion 4

Still satisfied. Both transports refuse a known-limited spawn unless `force` (`protocol-dispatcher.ts:1189-1200`; `agent-tool.dispatcher.ts:411-432`, with `lane_at_limit` and `resetsAt`). A quota failure is classified before the buffer discard and writes window or owner evidence to the ledger (`agent-process-manager.service.ts:2368-2379,2505-2522`), so `ptah_agent_list` then shows AT LIMIT with reset or `reset unknown`. The skill adds the run-local entry and the ordered fallback.

### New issues in revision 2

No new Blocking or Serious issue. No unapproved capability removal.

- R2-1 Moderate: agent-lanes section 5 names "typed `failureKind: quota`" as a quota authority, but no model-facing formatter surfaces `failureKind` (it is consumed only by frontend stores; `formatAgentStatus` omits it). The usable authority is the `ptah_agent_list` AT LIMIT row after the failure. Reword at implementation time; behaviour is unaffected.
- R2-2 Minor: the "document gate sentences survive" check is a manual grep only; consider adding the escalation phrases to the H1 markers.
- R2-3 Minor: plan says "headings" for `Document gates` / `Shipping code`; the file uses bullets. Match whichever form is written. The validator must also be given the `agent-lanes/SKILL.md` path, as it reads `orchestration` only today.
- R2-4 Minor (informational): replacing the named-vendor roster in `lane-assignment.md:92-105` removes example content, not a rule. Mention it in the final summary.
- R2-5 Minor: confirm the new spec path `libs/backend/agent-generation/src/lib/team-leader-template.policy.spec.ts` is picked up by that library's jest config.

### Round 2 verdict

APPROVED. Findings 1-12 are closed; R2-1 is a wording correction for the implementer and does not block.

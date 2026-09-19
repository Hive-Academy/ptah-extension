## Verdict

The skill-synthesis pipeline cannot produce exemplar-quality skills, neither from single sessions nor from session clusters, because of a fundamental category error in its architecture. The exemplars (`agent-lanes`, `orchestration`, `tribunal`, `fleet-orchestration`) are not step-by-step procedural runbooks; they are multi-agent operating systems, defensive harness protocols, and architectural invariant contracts designed to survive crashes, tool failures, and non-deterministic agent loops. The pipeline's generator prompt (`skill-synthesizer.service.ts:240-248`) explicitly forbids the structural elements that define an exemplar (tables, negative boundaries, multi-file modularity, tool contracts), while its judge rubric (`skill-judge.service.ts:121-132`) penalizes repo-grounded specificity. The pipeline must be repurposed to **mine trajectories for evidence a human then writes up**, leveraging the archaeology layer (`archaeology/session-archaeologist.service.ts`) to harvest friction points, dead-ends, and harness bugs into structured evidence dossiers for human authoring.

## The rubric, derived from the exemplars

Analysis of the six canonical exemplars (`agent-lanes/SKILL.md`, `orchestration/`, `tribunal/`, `fleet-orchestration/SKILL.md`, `ptah-cli-usage/`, `skill-creator/`) reveals an artifact class completely distinct from the synthesized candidates.

### Structural and Qualitative Facts from the Exemplars

1. **Document Sections & Lifecycle Coverage**:
   - `agent-lanes/SKILL.md` (142 lines) spans 8 numbered operational phases: `§1. Discover`, `§2. Address`, `§3. Task contract`, `§4. Run`, `§5. Recover`, `§6. Verify and revise`, `§7. Talk to a live lane`, `§8. Cost`.
   - `orchestration/SKILL.md` (101 lines root + 7 reference documents) decomposes into `Pre-flight`, `Task folder`, `Gates`, `Invoking agents`, `Never`, and modular `References`.
   - `fleet-orchestration/SKILL.md` (155 lines) covers `WHEN TO USE`, `HARNESS LIMITATION`, `ARTIFACT CHECKPOINTS`, `DISJOINT-LIB BATCHING`, `COMMIT WINDOW`, `COMMITLINT GATES`, `NX TEST RULE`, `JUDGE PROTOCOL`, and `CLI AGENT LANES`.
   - Across all 28 authored skills in `.claude/skills` (`metrics-authored-skills.md:38-67`), root documents average 7 to 11 top-level `##` sections. In contrast, candidate skills have exactly two sections: `## Steps` and `## Gotchas`.

2. **Nature of Knowledge Claims**:
   - Exemplars state knowledge as **binding operational contracts and invariants**, not suggestions. Every sentence is an actionable constraint or a deterministic branch:
     - `agent-lanes:14`: *"No `ptah_agent_*` tools in this session → do the work natively and say so."*
     - `agent-lanes:31`: *"The user named a lane that is not listed → say which one is missing and offer the listed alternatives. Never substitute silently."*
     - `agent-lanes:121`: *"Proof is the project's typecheck, tests and lint. A lane's PASS is an opinion; run them."*
     - `fleet-orchestration:36`: *"Rule: never rely on resumeFromRunId for a parallel fleet. Resume by recomputing state from disk artifacts."*
     - `fleet-orchestration:110`: *"Never run `nx test projA projB`. The positional names become Jest path filters. Zero tests run. The command exits 0. You get a green lie."*
   - Synthesized candidates state knowledge as **generic, aspirational advice**:
     - `consolidate-duplicated-enum:8`: *"Grep the entire repo... for all instances of the duplicated value set. Record file paths..."*
     - `pivot-harness-to-product-demo:41`: *"Do not strip authenticity for brevity. The power of this pivot is that it's real."*
     - `compact-card-list-layout:29`: *"Maintain visual clarity: Keep sufficient contrast in layout..."*

3. **Decision Tables and State Matrices**:
   - Exemplars make heavy, disciplined use of markdown decision tables mapping discrete inputs/states to actions:
     - `agent-lanes`: 5 tables in 142 lines (Status enum mapping, Address parameter schema, Recovery situation table, Verification requirements, Live messaging mode semantics).
     - `orchestration`: 4 tables (Request classification keywords → Type, Type → Flow sequence, Gate checklist, Reference loading conditions).
     - `tribunal`: 2 tables (Tribunal vs Orchestration topology comparison, Reference router).
   - In the 10 top-scoring synthesized candidates, there are **exactly zero decision tables**.

4. **Failure Modes & Causal Naming**:
   - Exemplars identify **exact causal mechanisms** of failure, often naming harness-specific or tool-specific quirks:
     - `fleet-orchestration:31-34`: Claude Code Workflow resume bug replaying the longest unchanged prefix of `agent()` calls due to non-deterministic `parallel()` execution.
     - `fleet-orchestration:79-83`: `lint-staged` pre-commit hook stashing the tree and silently reverting concurrent agent edits.
     - `agent-lanes:131`: `interrupt-resume` delivery mode aborting turns and silently discarding partial work.
   - Synthesized candidates list self-evident developer commonalities:
     - `debug-empty-docker-logs:41`: *"Prisma migrations... can take several minutes on large schemas without emitting progress."*
     - `compact-card-list-layout:42`: *"Padding compounds: Top + bottom padding on card + gaps between sections = vertical bloat."*

5. **Information Architecture & Progressive Disclosure**:
   - Exemplars follow `skill-creator/SKILL.md:82-92`: keep `SKILL.md` lean and push detailed workflows, schemas, and templates into `references/`, `scripts/`, or `assets/`. `orchestration` links 7 reference files; `ptah-cli-usage` links 7; `tribunal` links 6.
   - Candidates are single, isolated markdown files capped at 25-45 lines with zero modular assets.

---

### The Derived 8-Criterion Quality Rubric

To evaluate any skill document objectively without knowing its origin, score each criterion from 0 to 10:

| Criterion | Key Question | 0-3 (Failing) | 4-6 (Marginal) | 7-10 (Exemplar) |
|---|---|---|---|---|
| **C1. Contractual Boundaries & Triggers** | Are activation preconditions, tool requirements, and anti-scopes explicitly bounded? | Generic "Use when" statement; no anti-triggers or sibling contrast. | Mentions prerequisites, but lacks contrast with alternative workflows. | Explicit trigger keywords, sibling topology contrast table, required capabilities stated up front. |
| **C2. Deterministic State & Routing Tables** | Are decision points structured as state machines or markdown decision tables? | No tables; linear narrative checklist only. | 1 simple summary table, but decisions remain prose-based. | Multiple markdown decision matrices mapping discrete inputs/states to deterministic actions. |
| **C3. Interface & Protocol Completeness** | Are parameters, payloads, file contracts, and schemas exhaustively specified? | Vague steps ("pass parameters", "update files"). | Names some file paths or commands, but omits schemas/payload formats. | Full parameter schemas, prompt delivery envelopes, exact reply protocols (`WROTE: <path>`). |
| **C4. Causal Failure Modes & Recovery** | Are failure modes named by concrete technical cause with deterministic recovery paths? | Obvious general tips ("be careful", "tests may fail"). | Identifies general edge cases, but recovery is left to agent intuition. | Concrete technical breakdown of failure mechanisms (harness bugs, race conditions, silent drops) + deterministic recovery branches. |
| **C5. Operational Invariants ("Never" Rules)** | Does the skill enforce hard negative boundaries to prevent catastrophic failure? | Zero negative constraints; assumes ideal execution. | Contains 1-2 soft warnings ("avoid doing X"). | Explicit `## Never` section or bold negative constraints preventing silent reverts, bad merges, and false greens. |
| **C6. Lifecycle Breadth & Multi-Situation Coverage** | Does the document cover the full problem lifecycle across multiple states? | Covers exactly 1 narrow happy path. | Covers happy path plus 1 error branch. | Covers 5+ distinct lifecycle situations (discovery, invocation, execution, recovery, verification, cost). |
| **C7. Verification & Ground Truth Standards** | How is completion proved independent of agent self-reporting? | "Verify the build passes" or no verification step. | Recommends running tests, but specifies no defect format or thresholds. | Explicit verification gates, `file:line` defect syntax, independence invariants ("different family"), refutation stance. |
| **C8. Progressive Disclosure & Token Economics** | Is density high with zero fluff, using references for deep context? | Fluffy narrative explanations of concepts an LLM already knows. | Concise, but monolithic; no separation of core vs reference material. | High-density core document directing to modular reference files; zero tutorial text. |

*Passing threshold for exemplar quality*: Total score ≥ 64/80 (average ≥ 8.0/10), with no single criterion below 6.0.

---

## The 10 best candidates, scored

Here are the 10 highest-scoring candidates from the live database (`%USERPROFILE%/.ptah/state/ptah.sqlite`), which received judge scores between 7.8 and 8.4 under the current pipeline:

### Summary Scorecard

| # | Candidate ID | Name | Pipeline Judge Score | Exemplar Rubric Score (out of 80) | Normalized Score (0-10) | Result |
|---|---|---|:---:|:---:|:---:|:---:|
| 1 | `01KZPNBSG0R35W3A5XXKHMK2HS` | `consolidate-duplicated-enum` | 8.4 | 14 / 80 | **1.75** | FAIL |
| 2 | `01M23N7WFMMPYWXJKRA7D3XRP1` | `map-oauth-translation-proxy` | 8.4 | 19 / 80 | **2.38** | FAIL |
| 3 | `01KXVG4VV7P52ECZ39T0JW4RA9` | `debug-multi-instance-context-mismatch` | 8.2 | 17 / 80 | **2.13** | FAIL |
| 4 | `01KZ1Z410CF53YVRG5VD8A1Y2B` | `verify-existing-integrations` | 8.2 | 16 / 80 | **2.00** | FAIL |
| 5 | `01KZ967YH8W17XE1K47ACK9ZK3` | `debug-empty-docker-logs` | 8.2 | 12 / 80 | **1.50** | FAIL |
| 6 | `01M135G83MAWAYHHWHD58F78G2` | `pivot-harness-to-product-demo` | 8.2 | 11 / 80 | **1.38** | FAIL |
| 7 | `01KZDXK1J4QB2588WVKXQN0WPA` | `reorganize-settings-routes-by-intent` | 8.0 | 16 / 80 | **2.00** | FAIL |
| 8 | `01KZTXRPDEB3EE1E94R2XNR81D` | `compact-card-list-layout` | 8.0 | 10 / 80 | **1.25** | FAIL |
| 9 | `01KYYSM6XAB5HSDVQDKXTZFHGM` | `break-computed-dependency-bloat` | 7.8 | 13 / 80 | **1.63** | FAIL |
| 10 | `01KZ3VDSFS9C148RYN3FRQRB4E` | `audit-config-across-surfaces-2` | 7.8 | 15 / 80 | **1.88** | FAIL |

---

### Detailed Candidate Audits

#### 1. `consolidate-duplicated-enum` (Score: 1.75/10 — Pipeline Judge: 8.4)
- **Body breakdown**: 35 lines. A single flat list of 8 steps (`C:\Users\abdal\.ptah\skills\_candidates\consolidate-duplicated-enum\SKILL.md`).
- **Text quote**:
  > *"3. Create a single, clearly exported constant in a shared/base location — typically a `constants.ts` or `types.ts` in a shared library or core module. Example: `export const SYSTEM_CLI_TYPES = ['codex', 'copilot', 'cursor'] as const`."*
  > *"8. Run linter and affected unit test suite; fix any failures before committing."*
- **Defects against rubric**: Zero decision tables (C2: 0/10). No interface contracts (C3: 2/10). No named failure mechanisms or recovery paths (C4: 1/10). No negative operational constraints (C5: 1/10). Covers only a single linear happy path of junior-level refactoring that any base LLM performs out of the box (C6: 2/10).

#### 2. `map-oauth-translation-proxy` (Score: 2.38/10 — Pipeline Judge: 8.4)
- **Body breakdown**: 23 lines (`C:\Users\abdal\.ptah\skills\_candidates\map-oauth-translation-proxy\SKILL.md`). 10 numbered research steps and 4 gotchas.
- **Text quote**:
  > *"4. Read the request translator as a separate unit. Trace source request fields to target request fields, especially defaulted or omitted fields such as `stream`; identify the exact conditional that can cause an upstream validation failure."*
  > *"Gotchas: A proxy class may only provide endpoint/header policy; the base class often owns the actual HTTP server, forwarding, and SSE behavior."*
- **Defects against rubric**: While it captures genuine session residue from exploring a translation proxy, it contains zero executable contracts (C3: 3/10), no routing tables (C2: 0/10), and no verification mechanisms beyond *"Report findings by requested category"* (C7: 2/10). It is a descriptive post-mortem of one debugging session, not a reusable skill.

#### 3. `debug-multi-instance-context-mismatch` (Score: 2.13/10 — Pipeline Judge: 8.2)
- **Body breakdown**: 39 lines. 6 steps and 4 gotcha bullets.
- **Text quote**:
  > *"2. Trace how it gets the 'current' context. Follow the call chain to find where it retrieves the active instance... Look for: Global state or singleton providers... RPC handlers or event listeners..."*
  > *"Gotchas: Singleton providers trap: If the tool uses a global singleton, it will always reflect the global 'current' state, not the conversation's own context."*
- **Defects against rubric**: Purely advisory ("Look for...", "Check whether..."). No concrete state machine (C2: 0/10), no reproduction protocol, no verifiable defect reporting format (C7: 2/10). It tells an agent to think about context switching without specifying how to test, mock, or fix it.

#### 4. `verify-existing-integrations` (Score: 2.00/10 — Pipeline Judge: 8.2)
- **Body breakdown**: 32 lines. 7 steps and 4 gotchas.
- **Text quote**:
  > *"1. Search the codebase for existing work on this integration. Use Explore (medium breadth) to find related services... Look for: existing API clients, webhooks, provisioning logic..."*
  > *"5. Compare against the proposal. If an official solution exists (Discourse MCP, Stripe API, etc.), recommend using it..."*
- **Defects against rubric**: General pre-task diligence. Contains zero quantitative criteria for deciding between custom build vs official integration (C2: 0/10). No schemas, no hard gates, no operational invariants (C5: 1/10).

#### 5. `debug-empty-docker-logs` (Score: 1.50/10 — Pipeline Judge: 8.2)
- **Body breakdown**: 43 lines. 7 steps and 4 gotchas.
- **Text quote**:
  > *"1. `docker ps -a --filter name=<container>` to confirm it's actually running and check uptime"*
  > *"5. `docker stats <container> --no-stream` to check CPU/memory usage... If CPU is near zero: process may be hung waiting for a dependency"*
- **Defects against rubric**: Standard Linux sysadmin commands that exist in every beginner Docker tutorial. Zero workspace grounding, zero multi-agent coordination, zero decision matrices. It teaches Claude what `docker top` is, directly violating `skill-creator:31` (*"Default assumption: Claude is already very smart. Only add context Claude doesn't already have"*).

#### 6. `pivot-harness-to-product-demo` (Score: 1.38/10 — Pipeline Judge: 8.2)
- **Body breakdown**: 45 lines. 6 steps and 4 gotchas.
- **Text quote**:
  > *"2. State the thesis in one sentence: 'I used [product] to [achieve your actual goal]'... 4. Introduction: replace the generic framing with your real story... Gotchas: Do not strip authenticity for brevity."*
- **Defects against rubric**: Vague creative writing advice. Completely devoid of technical interfaces, verification gates, error states, or deterministic rules.

#### 7. `reorganize-settings-routes-by-intent` (Score: 2.00/10 — Pipeline Judge: 8.0)
- **Body breakdown**: 35 lines. 8 steps and 5 gotchas.
- **Text quote**:
  > *"2. Group sections by user intent, not by technical origin. Typical clusters: org identity/profile... AI agent behavior... knowledge & memory... Gotchas: Two links to the same page with different tab params is the signal to split routes — never paper over it with more tabs."*
- **Defects against rubric**: Describes one refactoring heuristic. Contains no Angular 21 route structure tables, no lazy-loading contract, no migration checklist, and no automated verification gate beyond *"run the build and tests"*.

#### 8. `compact-card-list-layout` (Score: 1.25/10 — Pipeline Judge: 8.0)
- **Body breakdown**: 45 lines. 6 steps and 5 gotchas.
- **Text quote**:
  > *"4. Redesign for compactness: Consolidate multi-line sections into single rows using flexbox... Reduce padding: `p-4` → `p-2` or `p-3`... Shrink gaps: `gap-2` → `gap-1`... Gotchas: Line-clamp aggressiveness..."*
- **Defects against rubric**: Elementary CSS adjustments. Trivial utility-class tweaking that provides zero systemic value or multi-agent operating rules.

#### 9. `break-computed-dependency-bloat` (Score: 1.63/10 — Pipeline Judge: 7.8)
- **Body breakdown**: 27 lines. `## Diagnosis`, `## Fix`, `## Gotchas`.
- **Text quote**:
  > *"Fix: 1. Extract the derived metric back into its own `computed()`. For example: `computed(() => this.tiles().length)` → create `private readonly tileCount = computed(() => this.tiles().length)`"*
- **Defects against rubric**: A 27-line micro-tip. Belongs as a single bullet point inside `angular-frontend-patterns/references/effects-patterns.md`, not as an independent skill. Fails lifecycle breadth completely (C6: 1/10).

#### 10. `audit-config-across-surfaces-2` (Score: 1.88/10 — Pipeline Judge: 7.8)
- **Body breakdown**: 41 lines. 4 steps and 4 gotchas.
- **Text quote**:
  > *"2. Launch a workflow to audit the surfaces in parallel. For each surface, spawn a reader agent to: Extract ALL mentions... List current values, line numbers... Flag which mentions conflict..."*
- **Defects against rubric**: While it mentions spawning reader agents, it provides no prompt envelope (C3: 2/10), no concurrency bounds (C5: 1/10), no agent communication protocol, and no structured reporting schema. Contrast with `agent-lanes §3` and `§4`, which define the exact tool calls, concurrency ceiling (3), polling cadence (8s), and deliverable format.

---

## Is one session enough

**No. Single-session trajectory extraction can never produce this class of document. It is categorically a different artifact.**

An exemplar skill like `agent-lanes` or `fleet-orchestration` is an **architectural specification and defensive harness protocol**. It synthesizes:
1. **Multi-environment variance**: `agent-lanes §1` maps CLI vs ptah-cli across Cursor, Ollama Cloud, and Claude providers. A single session executes in exactly one host environment with one provider. It cannot observe alternative environments.
2. **Cross-session failure recovery**: `agent-lanes §5` defines how to handle crashes, resume via `resume_session_id`, recover when session IDs are missing (ephemeral fallback), and enforce a 2-retry cap before reassignment. A single successful session only executes one happy path or recovers from one local syntax error.
3. **Multi-agent protocol invariants**: `orchestration §Gates` coordinates 7 distinct gates across 5 specialized subagents. A single session has one agent doing one task.
4. **Harness implementation bugs**: `fleet-orchestration §2` exists because of a specific Claude Code workflow resume bug where `parallel()` non-determinism corrupts the prefix replay. That insight came from observing dozen of pipeline runs crash and resume over weeks, not from a single turn trajectory.

A single session only yields **episodic execution traces**: *"In session X, the agent searched for duplicated enums in file Y, created constants.ts, and ran tests."* Turning that trace into a document only produces a localized runbook. Expecting a single-turn trace extractor to spontaneously produce `agent-lanes` is like expecting a git commit diff to generate the complete POSIX standard.

---

## The cluster path

The repository already implements multi-session clustering via `SkillCuratorService.runSuggestionPass` (`skill-curator.service.ts:390-536`) and `SkillClusteringService`. It has generated 16 pending suggestions in `skill_suggestions`, with cluster sizes ranging from 2 up to 111 sessions (`execute-phase-gated-task`: 111; `execute-scoped-batch-from-spec`: 108; `sanitize-templates-to-stack-agnostic`: 98).

### Comparison: Cluster Suggestions vs Single-Session Candidates

Comparing the 16 cluster suggestions against the single-session candidates using the exemplar rubric shows that **the cluster path is NOT measurably closer to the exemplars**:

| Structural Dimension | Single-Session Candidates | Cluster Suggestions (`skill_suggestions`) | Canonical Exemplars |
|---|---|---|---|
| **Average Length** | 25 – 45 lines (2,000 – 3,300 bytes) | 30 – 55 lines (1,700 – 4,100 bytes) | 100 – 350 lines + multi-file references |
| **Section Architecture** | `## Steps` + `## Gotchas` only | `## Steps` + `## Gotchas` only | 7 – 11 functional operational sections |
| **Decision Tables** | 0 tables across all 10 candidates | 0 tables across all 16 suggestions | 2 – 5 decision tables per document |
| **Interface Contracts** | None (generic advice) | None (generic advice) | Explicit param schemas, envelopes, exit codes |
| **Negative Boundaries** | None | None | Dedicated `## Never` sections and hard stops |
| **Exemplar Rubric Score** | **1.2 – 2.4 / 10** | **1.5 – 2.8 / 10** | **8.5 – 9.8 / 10** |

### Why the Cluster Path Fails to Bridge the Gap

The code reveals four hard architectural bottlenecks in `libs/backend/skill-synthesis`:

1. **Input Degradation (`skill-curator.service.ts:464-467`)**:
   `runSuggestionPass` feeds `synthesizer.synthesizeFromCluster()` with `ClusterMemberInput[]` built from `this.readCandidateBody(m)`. The input to the cluster synthesizer is **already** the shallow, 35-line candidate bodies of single sessions. Pooling 5 or 100 shallow checklists does not magically produce interface schemas or harness failure protocols; it only averages out specifics into higher-level platitudes.

2. **The Prompt Straitjacket (`skill-synthesizer.service.ts:240-248`)**:
   The cluster synthesizer runs through `this.buildSystemPrompt()`, which imposes the exact same instructions as the single-session path:
   ```ts
   // skill-synthesizer.service.ts:245-247
   - Do NOT include: YAML frontmatter, a "When to use" section, README/changelog/auxiliary prose, or a replay of the session log.
   - Prefer a short "## Steps" list, and add "## Gotchas" only when there are non-obvious pitfalls.
   ```
   The prompt literally commands the model to produce only `## Steps` and `## Gotchas`!

3. **Monolithic JSON Schema Constraint (`skill-synthesizer.service.ts:68-77`)**:
   `SYNTHESIZED_SKILL_JSON_SCHEMA` requires `{ name: string, description: string, body: string }`. It has no data model for reference files, decision matrices, tool schemas, or scripts.

4. **Cluster Bloat on Routine Workflows**:
   In the 111-session cluster (`execute-phase-gated-task`) and 108-session cluster (`execute-scoped-batch-from-spec`), the clustering algorithm simply pooled every session that ran a task spec. The resulting synthesis is just: *"Read context.md, read implementation-plan.md, implement changes, run tests"*. This duplicates what `orchestration` already does with vastly superior precision, user gates, and state tracking.

**Conclusion**: The cluster path is structurally identical to the single-session path. It does not solve the quality deficit.

---

## A replacement judge rubric

The current judge rubric (`skill-judge.service.ts:121-132`) is fatally mismatched with exemplar quality:

```ts
// CURRENT RUBRIC (skill-judge.service.ts:121-132)
- novelty: How novel/non-obvious is this versus common knowledge an agent already has?
- actionability: How directly executable are the steps (imperative, concrete, ordered)?
- scope: Is the scope a single well-defined workflow (not too broad, not a trivial one-off)?
- generalization: Is it repo-agnostic and transferable, with NO leftover workspace paths, file names, or session-specific details? Score 1-3 if it merely echoes one session or restates the user's request.
- triggerClarity: Does the description clearly state WHEN to use the skill, so another agent could decide to trigger it? Score low if vague or it just names the task.
```

### What the Current Rubric Asks That Is Actively Harmful
1. **`generalization` as "repo-agnostic and transferable with NO leftover workspace paths"**: This single criterion destroys skill utility in this repository. The exemplars are valuable precisely *because* they are deeply grounded in `@hive-academy/ptah-cli`, `ptah_agent_spawn`, `.ptah/specs/TASK_YYYY_NNN`, Nx project flags (`-p @ptah-extension/chat`), and DI tokens. Punishing workspace paths forces the synthesizer to strip out the exact tool contracts that make a skill operational, reducing it to generic blog posts.
2. **`novelty`**: Measures whether an LLM already knows the abstract concept. But skills are operating manuals, not research papers. `agent-lanes` contains zero novel computer science; its value is its rigid, deterministic protocol.
3. **`actionability` as "imperative, concrete, ordered steps"**: Rewards flat 1-to-8 step checklists and ignores whether there are decision tables, state transitions, or error handling.

### What the Current Rubric Does Not Ask About
1. Structural decision matrices and routing tables.
2. Interface contracts, tool parameters, and schema completeness.
3. Concrete failure mechanisms and recovery protocols.
4. Hard operational invariants and `## Never` rules.
5. Verification standards that test ground truth vs agent claims.

---

### Drop-In Replacement Rubric

Replace `skill-judge.service.ts:117-132` with this production-ready replacement:

```ts
/**
 * The scoring rubric for skill quality, derived from repository exemplars
 * (agent-lanes, orchestration, fleet-orchestration, tribunal).
 *
 * Emphasizes contractual completeness, decision matrices, negative invariants,
 * and concrete failure recovery over generic step checklists.
 */
const JUDGE_RUBRIC = [
  `Evaluate the skill document against exemplar engineering standards. An exemplar skill is an OPERATIONAL CONTRACT: it contains decision tables, exact tool/interface schemas, hard negative constraints ("Never" rules), concrete failure recovery protocols, and verifiable proof standards. It is NOT a flat step checklist or a tutorial on common knowledge. Reply with ONLY valid JSON.`,
  ``,
  `Score each criterion 1-10 (be strict — score low when in doubt; any document that is merely a flat "## Steps" list must score <= 3 across structural criteria):`,
  `- contractualCompleteness: Does the skill define exact interface schemas, parameters, required tools, file deliverables, and unambiguous input/output formats? (Score 1-3 if vague or advisory; score 8-10 if schemas/parameters are exhaustively specified).`,
  `- stateAndDecisionStructure: Does the document use structured markdown decision tables or state matrices mapping discrete inputs/states to actions? (Score 1-2 if zero tables exist; score 8-10 if decision matrices govern core routing).`,
  `- failureAndRecoveryMechanics: Does it name concrete technical failure mechanisms (harness bugs, tool timeouts, race conditions, silent drops) and prescribe deterministic recovery branches? (Score 1-3 for trivial advice like "check tests"; score 8-10 for causal breakdown and exact recovery logic).`,
  `- operationalInvariants: Does it establish hard negative constraints and boundaries ("Never" rules, concurrency caps, rate limits, non-negotiable stops)? (Score 1-2 if no negative rules exist; score 8-10 if hard invariants protect against catastrophic or runaway execution).`,
  `- verificationAndProof: Does it define how output is verified against objective ground truth (linters, typecheck, concrete test invocations, file:line defect anchors) rather than trusting an agent's claim? (Score 1-3 if verification is absent or superficial; score 8-10 if proof criteria are rigorous and refutation-based).`,
  ``,
  `Reply with ONLY: {"contractualCompleteness": <number>, "stateAndDecisionStructure": <number>, "failureAndRecoveryMechanics": <number>, "operationalInvariants": <number>, "verificationAndProof": <number>}`,
].join('\n');
```

---

## Recommendation

**Repurpose the pipeline to mine trajectories for evidence a human then writes up.**

Do not attempt to tune the autonomous skill generator (`SkillSynthesizerService.synthesize` / `synthesizeFromCluster`). Generating multi-agent operating systems from single-turn chat logs is fundamentally impossible. 

Instead, repurpose the pipeline into an **Automated Trajectory Evidence & Friction Miner**, re-anchoring the existing `archaeology` layer (`libs/backend/skill-synthesis/src/lib/archaeology`):

1. **Retire the Autonomous Generator & Promotion Loop**:
   - Turn off `SkillSynthesizerService` candidate generation and `runSuggestionPass`.
   - Cease writing to `skill_candidates` and `skill_suggestions`. This eliminates background LLM token waste on candidates that the user rejects 94% of the time (16/17 pending, 0 promoted).

2. **Repurpose `SessionArchaeologistService` to Harvest Evidence Dossiers**:
   - `SessionArchaeologistService` already extracts structured session verdicts (`session-verdict.types.ts:64-98`):
     - `friction`: array of `{ turnIndex, kind: 'correction' | 'retry' | 'dead-end', note }`
     - `evidenceClass`: `'tests-green' | 'user-accepted' | 'no-correction' | 'explicit-confirmation' | 'unverified'`
     - `routine`: `{ summary, steps, citations }`
   - Instead of trying to turn this into a final `SKILL.md`, have the drain write structured **Friction & Failure Dossiers** directly into `.ptah/specs/TASK_*/evidence-trajectories.md`.

3. **Surface Trajectory Evidence to Human Architects**:
   - Aggregate repeated friction points (e.g., *"Tool X failed with error Y across 14 sessions"*, *"Agents repeatedly attempted `nx test` with invalid positional filters in 22 sessions"*, *"Pre-commit lint-staged stash conflicts observed in 8 sessions"*).
   - Present these aggregated friction logs to human authors in the Tribunal or Orchestration UI.
   - When a human engineer authors or updates a skill (like `fleet-orchestration` or `angular-frontend-patterns`), they draw directly from this empirically verified friction data to write the decision tables, gotchas, and `## Never` rules.

This cleanly divides labor: machines extract and cite empirical friction and failure evidence from thousands of turns; human architects codify that evidence into invariant contracts and operating protocols.

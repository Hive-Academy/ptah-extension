## Strongest point — which answer is most convincing, and why

**Answer B is the most technically convincing.** 

Answer B correctly diagnosed the core architectural defect: CLI-lane mechanics (discovery, spawn→poll→read, resume, concurrency, and bounded revision) are independently re-authored across five separate files (`cli-agent-delegation.md`, `orchestration/SKILL.md:287–385`, `vendor-panel.md:95–121`, `relay.md:44–106`, and `crucible.md`), causing specification drift. Rather than inventing a non-existent shared destination, Answer B established existing `orchestration/references/cli-agent-delegation.md` as the natural Single Source of Truth (SSOT). Furthermore, Answer B maintained the critical architectural distinction between prompt-loaded context and bundle-only files on disk (e.g., `skill-creator/LICENSE.txt`), preventing the conflation of repository disk footprint with prompt token load.

---

## Flaws — concrete errors, unsupported or wrong claims, missed items

### Earlier Answer (Self-Critique)
- **Fatal Conflation of Bundle Size with Prompt Context (Error)**: Claimed **98.8 KB (~24,700 tokens)** saved by deleting 11 orphan `.ts` components in `ptah-angular/skills/.../assets/`, asserting they "dump code into context". **VERIFICATION: FALSE**. Under progressive disclosure, only `SKILL.md` is loaded into prompt context on trigger. Markdown links in `SKILL.md` are passive file references; the `.ts` files are never injected into the context window. Deleting them saves 98.8 KB of plugin bundle distribution size, but **0 prompt tokens on trigger**.
- **Overstated Savings on Task Spec Block (Error)**: Claimed 13.0 KB savings across spawns. **VERIFICATION: OVERSTATED**. `renderTaskSpecAgentBlock` is ~1.5 KB total; trimming ID allocation saves ~1.1 KB per spawn, not 13 KB in one context.

### Answer A
- **Unsyncable Shared Destination (Error)**: Proposed a new shared file `cli-runtime.md` outside existing skill trees. **VERIFICATION: ARCHITECTURALLY INVALID**. In [`libs/backend/harness-sync/src/lib/targets/workspace-target.ts:349–363`](D:/projects/ptah-extension/libs/backend/harness-sync/src/lib/targets/workspace-target.ts#L349-L363) and [`harness-manifest.builder.ts:304–325`](D:/projects/ptah-extension/libs/backend/harness-sync/src/lib/manifest/harness-manifest.builder.ts#L304-L325), `harness-sync` copies skills strictly by slug folder (`{skillsDir}/{slug}/`). A loose shared file outside skill directories is ignored by the builder and never copied to target harnesses (`.claude`, `.agents`, `.github`, `.cursor`).
- **Table Padding Overestimation (Flaw)**: Ranked 73.8 KB of table whitespace padding as its #1 cut. While physical bytes exist on disk, repetitive padding spaces and hyphens compress efficiently in BPE tokenizers; real token savings are negligible compared to prose cuts.
- **Missed Items**: Missed the task ID allocation over-privilege across all 15 agent templates and the illegal CLI delegation partial in `visual-reviewer` and `ui-ux-designer`.

### Answer B
- **Flawed Assumption on Relative Path Divergence (Error)**: Asserted that cross-skill relative links fail because "(Claude/Codex/Copilot paths differ)". **VERIFICATION: FALSE REGARDING RELATIVE DEPTH**. As verified in [`claude-target.ts:68`](D:/projects/ptah-extension/libs/backend/harness-sync/src/lib/targets/claude-target.ts#L68) and [`rival-targets.ts:12–16`](D:/projects/ptah-extension/libs/backend/harness-sync/src/lib/targets/rival-targets.ts#L12-L16), every harness installs skills as sibling directories in a flat skills root (`.claude/skills/`, `.agents/skills/`, `.github/skills/`, `.cursor/skills/`). The relative link `../../orchestration/references/...` resolves identically in all five environments.
- **Missed Items**: Missed the `renderTaskSpecAgentBlock` specialist over-privilege and the contradictory `<!-- STATIC:CLI_DELEGATION -->` injection.

---

## Verified facts — the claims you checked, TRUE/FALSE with file:line

1. **`ptah-angular` skill `assets/*.ts` files are loaded into prompt context**: **FALSE**.
   - [`apps/ptah-extension-vscode/assets/plugins/ptah-angular/skills/angular-gsap-animation-crafter/SKILL.md:480–520`](D:/projects/ptah-extension/apps/ptah-extension-vscode/assets/plugins/ptah-angular/skills/angular-gsap-animation-crafter/SKILL.md#L480-L520).
   - The `.ts` files are referenced as markdown links in example workflows on disk. Harness synchronization only injects `SKILL.md` into the agent context on trigger. The assets are bundle payload, not trigger prompt context.
2. **`visual-reviewer` and `ui-ux-designer` templates inject `CLI_DELEGATION` despite being forbidden to delegate**: **TRUE**.
   - [`libs/backend/agent-generation/templates/agents/visual-reviewer.template.md:36`](D:/projects/ptah-extension/libs/backend/agent-generation/templates/agents/visual-reviewer.template.md#L36) and [`ui-ux-designer.template.md:39`](D:/projects/ptah-extension/libs/backend/agent-generation/templates/agents/ui-ux-designer.template.md#L39).
   - Both include `<!-- STATIC:CLI_DELEGATION -->`, directly contradicting [`orchestration/references/agent-catalog.md:20,23,33`](D:/projects/ptah-extension/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/agent-catalog.md#L20-L33) (`-` = should not delegate) and [`cli-agent-delegation.md:493–494`](D:/projects/ptah-extension/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/cli-agent-delegation.md#L493-L494).
3. **`renderTaskSpecAgentBlock` teaches task ID allocation to every specialist**: **TRUE**.
   - [`libs/shared/src/lib/types/task-spec.contract.ts:506–541`](D:/projects/ptah-extension/libs/shared/src/lib/types/task-spec.contract.ts#L506-L541).
   - Lines 527–533 instruct agents to run `git fetch`, `git ls-tree origin/main`, calculate `NNN+1`, append hex characters, and lock via `mkdir`. Injected into all 15 templates via `<!-- STATIC:TASK_SPEC_CONTRACT -->`, bloating leaf specialists who never create tasks.
4. **Cross-skill relative links survive across target harnesses**: **TRUE**.
   - [`libs/backend/harness-sync/src/lib/targets/claude-target.ts:68`](D:/projects/ptah-extension/libs/backend/harness-sync/src/lib/targets/claude-target.ts#L68), [`rival-targets.ts:12–16`](D:/projects/ptah-extension/libs/backend/harness-sync/src/lib/targets/rival-targets.ts#L12-L16), and [`workspace-target.ts:352`](D:/projects/ptah-extension/libs/backend/harness-sync/src/lib/targets/workspace-target.ts#L352).
   - All supported CLIs place skills into a flat directory structure (`{harness_dir}/skills/{slug}/`). A reference from `tribunal/references/*.md` to `../../orchestration/references/*.md` resolves uniformly.

---

## Revise? — final position: top 5 ranked actions + final SSOT decision

### Top 5 Ranked Actions (Ranked by active prompt context savings)

| Rank | File / Component | Action | Est. Context Saving |
|---|---|---|---|
| **1** | [`orchestration/SKILL.md`](D:/projects/ptah-extension/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/SKILL.md) | Strip inlined CLI delegation (L287–385), checkpoints (L198–254), strategies (L87–124), and task-init (L125–161). Convert to a lean routing entry point (<150 lines). | **~18 KB Entry** (~4,500 tok/trigger) |
| **2** | [`orchestration/references/cli-agent-delegation.md`](D:/projects/ptah-extension/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/cli-agent-delegation.md) & [`tribunal/references/`](D:/projects/ptah-extension/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/) | Deduplicate CLI transport into `cli-agent-delegation.md`. Strip duplicated spawn/poll/read loops and resume sessions from `vendor-panel.md:95–121`, `relay.md:44–106`, and `crucible.md`. | **~16–20 KB Entry/Ref** (~4,000–5,000 tok) |
| **3** | [`orchestration/references/agent-catalog.md`](D:/projects/ptah-extension/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/agent-catalog.md) | Retain selection and capability matrices (L1–99). Delete 460 lines of verbose per-agent profile blocks (L100–559) already defined in template frontmatter. | **~17 KB Reference** (~4,250 tok on load) |
| **4** | [`team-leader.template.md`](D:/projects/ptah-extension/libs/backend/agent-generation/templates/agents/team-leader.template.md) & Non-Delegator Templates | Consolidate five repetitive return prompt templates (L225–360) into a single schema table (~5 KB). Remove illegal `STATIC:CLI_DELEGATION` from `visual-reviewer` and `ui-ux-designer` (~2.1 KB). | **~7 KB Spawn** (~1,750 tok per spawn) |
| **5** | [`task-spec.contract.ts`](D:/projects/ptah-extension/libs/shared/src/lib/types/task-spec.contract.ts) | Split `renderTaskSpecAgentBlock` into orchestrator allocation rules vs a 7-line specialist deliverable contract, stripping git-scan and ID generation from 13 specialist prompts. | **~1.1 KB per spawn** across 13 roles |

*(Asset pruning note: Deleting the 11 `.ts` files from `ptah-angular` remains recommended for packaging hygiene to reclaim **98.8 KB bundle size**, but must not be counted toward LLM prompt token reductions).*

### Final SSOT Decision for Shared CLI Transport
Retain `orchestration/references/cli-agent-delegation.md` as the canonical **Single Source of Truth** for base CLI transport (discovery, spawn→poll→read lifecycle, resume session handling, concurrency boundaries).
- `harness-sync` flattens all installed skills under a common sibling parent (`.claude/skills/`, `.agents/skills/`, etc.), guaranteeing that relative citations (`../../orchestration/references/cli-agent-delegation.md`) resolve consistently across all supported CLIs.
- Creating a separate file outside skill roots violates the `harness-sync` discovery contract and breaks deployment.
- Tribunal references (`vendor-panel.md`, `relay.md`, `crucible.md`) cite `cli-agent-delegation.md` for runtime transport, retaining only Tribunal-specific deltas (multi-vendor tagging, Council diversity spread, Relay phase pinning, and Crucible judge/executor rubrics).

You are one expert on an independent review panel. READ-ONLY task: do NOT modify, create or delete any file in the repository. Only read files and run read-only shell commands.

# Question
Ptah ships prompt corpora (skills + subagent templates) into users' AI coding agents (Claude Code, Codex, Copilot, Cursor, Antigravity). Every loaded byte costs context tokens. Review them and answer:

1. CONTEXT SIZE: where are the biggest token wastes, and what concrete cuts give the largest reduction without losing capability?
2. CONCISE AUTHORING: what should a skill / subagent prompt contain so an agent has ONLY what it needs to do proper, advanced work — and what should be removed (things the model already knows, narrative, repeated rationale, examples that differ by one string, history of past bugs/tasks, etc.)? Propose a reusable authoring rubric/checklist that we can apply to ALL other skills.
3. TRIBUNAL vs ORCHESTRATION: compare these two skills and list concrete repetitions/overlaps (same concepts, same rules, same spawn/poll/read loops, same CLI-delegation guidance, same task-folder/spec rules, etc.). For each, say where the single source of truth should live and how the other should reference it.
4. SUBAGENT TEMPLATES: the same lens applied to the 15 templates + _shared partials.

# Corpus (absolute paths, Windows)
- Plugin skills root: D:\projects\ptah-extension\apps\ptah-extension-vscode\assets\plugins\  (plugins: ptah-core 749KB, ptah-nx-saas 429KB, ptah-angular 385KB, ptah-react 318KB, ptah-video 65KB, ptah-dotnet 53KB)
- Orchestration skill: D:\projects\ptah-extension\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\  (SKILL.md 25KB + references: agent-catalog 23KB, checkpoints 21KB, cli-agent-delegation 26KB, git-standards 9KB, strategies 22KB, task-tracking 16KB, team-leader-modes 16KB)
- Tribunal skill: D:\projects\ptah-extension\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\tribunal\  (SKILL.md 10KB + references: vendor-panel, council, forge, race, relay 14KB, crucible 16KB)
- Other large ptah-core skills: ptah-cli-usage (104KB), ui-ux-designer (100KB), ddd-architecture (68KB), technical-content-writer (68KB), humanize-library (60KB), skill-creator (40KB)
- Subagent templates: D:\projects\ptah-extension\libs\backend\agent-generation\templates\agents\  (15 *.template.md, team-leader 19KB largest; partials in _shared\)
- Prior audit for context (do not just repeat it): D:\projects\ptah-extension\.ptah\specs\TASK_2026_254\audit-findings.md and context.md; D:\projects\ptah-extension\.ptah\specs\TASK_2026_359\context.md

Constraints you must respect: skills load SKILL.md on trigger and references on demand (progressive disclosure); templates ship to every user's repo so must stay stack-agnostic; LLM-filled sections in templates are intentional; the tribunal and orchestration skills are intentionally SEPARATE workflows (peer panel vs hierarchy) — do not propose merging them, propose de-duplication.

Read the actual files. Every claim must cite file path + line or section. Estimate KB/token savings per recommendation.

# Output — exactly this structure, markdown, at most ~1500 words
## Position — top recommendation in 2 sentences
## Top cuts (ranked by savings) — table: file | problem | fix | est. saving KB
## Tribunal vs Orchestration repetitions — table: concept | where in tribunal | where in orchestration | single source of truth | fix
## Authoring rubric — numbered checklist (keep/cut rules) applicable to any skill or subagent prompt
## Template findings — bullets
## Tradeoffs / risks
## Confidence — high/medium/low + biggest risk

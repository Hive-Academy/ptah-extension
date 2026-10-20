# TASK_2026_662 BEFORE shots (pre-purge UI)

Build: Electron dist in worktree 646-after-shots (detached c779018ad), no rebuild. Viewport 1280x800.
Themes: dark = anubis, light = anubis-light. Seeded: 4 agents in Library (architect, backend-developer,
frontend-developer, code-reviewer); no providers configured, Ollama endpoints pointed at 127.0.0.1:1.
Capture script: capture-before.cjs (same folder). Private HOME/APPDATA/userData/DB; no TCP port used.
Known gaps: no seeded Skills/Commands (those library tabs show empty state); agent shows "no data yet"
scorecard/Success % (0 runs, so Enhance now is disabled with the 5-run message); light
agent-drawer-element shot not taken (drawer-element locator not visible; full-window drawer shot exists).
Settings > Providers: the "Judging & enhancement" row and Archaeologist/Synthesis/Judge/Replay rows live in
consumer assignments (Agent Orchestration > Background Model Roles); the Providers tab holds the routing map.

| screen | theme | file | shows |
|---|---|---|---|
| skills-header | dark | before-skills-header-dark.png | Skills tab landing (pause switch, stats strip, subview tabs) |
| skills-suggestions | dark | before-skills-suggestions-dark.png | Recommended subview |
| skills-candidates | dark | before-skills-candidates-dark.png | Sessions subview |
| skills-activity | dark | before-skills-activity-dark.png | Activity subview |
| library-skills | dark | before-library-skills-dark.png | Library > Skills kind tab |
| library-commands | dark | before-library-commands-dark.png | Library > Commands kind tab |
| library-agents | dark | before-library-agents-dark.png | Library > Agents kind tab |
| agent-card | dark | before-agent-card-dark.png | First agent library card (metrics / Success % / Enhance now control) |
| agent-drawer | dark | before-agent-drawer-dark.png | Agent detail drawer (scorecard / outcome signals) |
| agent-drawer-element | dark | before-agent-drawer-element-dark.png | Agent detail drawer element only |
| skills-settings | dark | before-skills-settings-dark.png | Skills > Settings panel |
| providers-top | dark | before-providers-top-dark.png | Settings > Providers (top of tab) |
| routing-map | dark | before-routing-map-dark.png | Routing map (incl. Judging & enhancement row) |
| routing-map-viewport | dark | before-routing-map-viewport-dark.png | Window with routing map scrolled into view |
| consumer-assignments | dark | before-consumer-assignments-dark.png | Consumer assignments rows (Archaeologist, Synthesis, Judge, Replay lanes) |
| consumer-assignments-viewport | dark | before-consumer-assignments-viewport-dark.png | Window with consumer assignments in view |
| skills-header | light | before-skills-header-light.png | Skills tab landing (pause switch, stats strip, subview tabs) |
| skills-suggestions | light | before-skills-suggestions-light.png | Recommended subview |
| skills-candidates | light | before-skills-candidates-light.png | Sessions subview |
| skills-activity | light | before-skills-activity-light.png | Activity subview |
| library-skills | light | before-library-skills-light.png | Library > Skills kind tab |
| library-commands | light | before-library-commands-light.png | Library > Commands kind tab |
| library-agents | light | before-library-agents-light.png | Library > Agents kind tab |
| agent-card | light | before-agent-card-light.png | First agent library card (metrics / Success % / Enhance now control) |
| agent-drawer | light | before-agent-drawer-light.png | Agent detail drawer (scorecard / outcome signals) |
| skills-settings | light | before-skills-settings-light.png | Skills > Settings panel |
| providers-top | light | before-providers-top-light.png | Settings > Providers (top of tab) |
| routing-map | light | before-routing-map-light.png | Routing map (incl. Judging & enhancement row) |
| routing-map-viewport | light | before-routing-map-viewport-light.png | Window with routing map scrolled into view |
| consumer-assignments | light | before-consumer-assignments-light.png | Consumer assignments rows (Archaeologist, Synthesis, Judge, Replay lanes) |
| consumer-assignments-viewport | light | before-consumer-assignments-viewport-light.png | Window with consumer assignments in view |

- (note dark) "Enhance now" buttons found on Agents tab: 4
- (note dark) drawer text: architect |  | authored | · | agent |  | × | OUTCOMES (30D) | no data yet | Actions | Enhance now | Needs 5 recorded runs before an enhancement can be proposed — this one has 0. There is not enough usage evidence to improve it yet. | Scorecard | no data yet | 0 inv | tokens: no data yet | cost: no data yet |  | No graded runs yet. |  | Graded runs accrue when this agent is invoked inside orchestra
- (note dark) routing map text: ROUTING MAP | Select a work node to see or change what it runs on | Needs attention | MAIN AGENT | Needs attention |  | PROVIDER: | Claude API |  | MODEL: | Default (chosen by Claude) |  | Effort: Provider default | Reassign | BACKGROUND ROLES | 6 roles | 6 roles | Follow main agent | 0 set · 6 following | Inspect | CLI AGENTS & MATRIX | 5 enabled | Execution priority: |  | Codex | → | Copilot | → | Antigravity | → | Opencode |  | 5 CLIs · 0 Ptah instances | Manage matrix
- (note dark) consumer rows: consumer-row-memory-curator, consumer-row-archaeologist, consumer-row-synthesis, consumer-row-judge, consumer-row-replay, consumer-row-judging-enhancement, consumer-row-decision
- (note light) "Enhance now" buttons found on Agents tab: 4
- (note light) routing map text: ROUTING MAP | Select a work node to see or change what it runs on | Needs attention | MAIN AGENT | Needs attention |  | PROVIDER: | Claude API |  | MODEL: | Default (chosen by Claude) |  | Effort: Provider default | Reassign | BACKGROUND ROLES | 6 roles | 6 roles | Follow main agent | 0 set · 6 following | Inspect | CLI AGENTS & MATRIX | 5 enabled | Execution priority: |  | Codex | → | Copilot | → | Antigravity | → | Opencode |  | 5 CLIs · 0 Ptah instances | Manage matrix
- (note light) consumer rows: consumer-row-memory-curator, consumer-row-archaeologist, consumer-row-synthesis, consumer-row-judge, consumer-row-replay, consumer-row-judging-enhancement, consumer-row-decision

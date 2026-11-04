# README notes — TASK_2026_877_85fa

Audience: developers evaluating or cloning PtahCode. Outcome: the GitHub README matches the Electron v2 surfaces the hidden-features analysis allows in public. Format: GitHub-flavored markdown README. Tone was fixed by the task (concrete, no SaaS filler) and by analysis § Proposed README outline plus § Claims to verify.

Skill load: this lane’s tool list has no skill-loading tool. The technical-content-writer role file was read from `D:\projects\ptah-extension\.claude\agents\technical-content-writer.md`. No extra skill was assigned by the task.

## What changed

- Replaced the YouTube thumbnail and watch URL with the landing hero poster linked to the production Orchestration mp4.
- Added a three-row table for the other live-demo catalog clips, using each entry’s label and description.
- Kept the eight docs-site clips. Their mp4 files are still under `apps/ptah-docs/public/assets/videos/`.
- Replaced “Three pillars” and “More capabilities” with What’s new in v2 plus the six analysis pillars (orchestration, cost, desktop, memory, remote/voice, repo trust), then providers, get started, development, contributing, license.
- Pointed new screenshot names at the raw GitHub docs path. Kept `chat-overview`, `chat-execution-tree`, `setup-hub`, and `agents-orchestration` beside the sections they still illustrate.
- Updated the stack line from `package.json` (this worktree), not from the task prompt’s Nx 23.2.1 figure.

## Video URL

**Choice:** poster `https://raw.githubusercontent.com/Hive-Academy/PtahCode/main/apps/ptah-landing-page/public/assets/live-demo/orchestration.jpg` linked to `https://ptah.live/assets/live-demo/orchestration.mp4`.

**Evidence:**

- Hero still and first catalog entry: `libs/web/landing/src/lib/sections/hero/hero.component.ts` (`src="/assets/live-demo/orchestration.jpg"`, catalog order starts at `orchestration`) and `libs/web/landing/src/lib/live-demo/live-demo-catalog.ts` (`id: 'orchestration'`, `video: '/assets/live-demo/orchestration.mp4'`).
- Hero spec expects that mp4 and webm: `hero.component.spec.ts`.
- Production origin: `apps/ptah-landing-page/src/index.html` canonical and `og:url` are `https://ptah.live`. The same file already publishes `https://ptah.live/assets/icons/ptah-icon.webp`, so `/assets/...` is the public asset root. The README already linked `https://ptah.live` and `https://ptah.live/download`.

The other three catalog rows use the same origin plus their `/assets/live-demo/<id>.mp4` paths. Posters use the raw GitHub URL, matching the required hero pattern. `screenshots-report.md` in this task folder was empty (header only) when this README was written. The v2 PNG names are used exactly as specified. They will 404 until the screenshot lane lands the files on `main`.

## Removed or rewritten claims

| Previous claim | Action | Reason |
| --- | --- | --- |
| YouTube `lMRFI0BrYvI`, caption “memory recall, sub-agent fan-out, and scheduled runs” | Removed | Task: swap for the hero video. That caption was not the catalog description. |
| “Orchestra Canvas — up to nine concurrent sessions in one drag-and-resize grid.” | Rewritten as the session rail: 20 tiles, 9 running, density and sort, legacy grid renders as the rail | Analysis § README corrections. Code: `MAX_CANVAS_TILES = 20` in `libs/frontend/canvas/src/lib/canvas-layout-intent.ts`; `MAX_RUNNING_SESSIONS = 9` in `canvas-running-cap.ts`. |
| Skill synthesis “promotes it to a permanent, shareable skill file” | Rewritten: judged diff, write only on Apply, threshold or cooldown can disable Enhance | F37. Automatic promotion is false. |
| Tribunal Council / Forge / Race / Crucible / Relay as a primary feature, plus the docs link | Removed from the feature list | F08 and § Claims to verify: webview page removed, skill not executed. The landing clip remains in the optional catalog table because the catalog titles it. That row is a video label, not a claim that a Tribunal run succeeded. |
| Messaging “with voice input” as if it were one feature with Discord thread context | Split: pairing, Electron hand-off (read-only until taken back, binding required), five Discord-only commands, gateway voice notes separate from the Voice tab | F39, F21. |
| “Cost and token tracking … with history and export” | Kept history. Dropped “export”. Added plan windows and unpriced contributions | Analysis: export was not re-checked. F16, F17. |
| Harness sync “every supported AI tool” with no safety rule | Named the targets found in code and the two safety rules (no delete of git-tracked or hash-mismatched skill; quarantine) | F49. Analysis listed `pi` as a seventh harness. This tree’s `createRivalTargets` is codex, copilot, cursor, antigravity, opencode, vscode. Claude is `ClaudeTarget`. No `pi` harness target was found under `libs/backend/harness-sync`. `pi` stays in the CLI lane list (F04), not the harness list. |
| “Monaco diff view” for the editor tools list | Git dock spot editor called CodeMirror. Monaco kept only for the skill-enhancement diff | F27, F37. `spot-editor.component.ts` import was the analysis evidence. Terminal, file tree, git status, and commit composer stay as the prior README claim. This pass did not re-prove each control. |
| Tree-sitter limited to JS, TS, Python, and Go, stated as the whole indexer | Kept those four as the existing documented set. Added unsupported-extension counts and unknown coverage on first index. Did not widen the language list | § Claims to verify. F41, F42. |
| “Angular 21 feature libraries” | Angular 22 | `package.json` `@angular/core` `~22.2.0`. |
| “benchmark engine retained” in the `libs/backend` comment | Dropped | Analysis said that phrase was not audited. |
| OpenRouter “more than 200 models” | Dropped the count. OpenRouter remains | § Claims to verify: the figure was not re-counted. |
| Implied “no account / no license key” | Not added | § Claims to verify. MIT, no trial, no credit card kept from the previous README. |
| 16-message runtime carry-over and secret redaction | Not written | Orchestrator spot-check: not found in `codex-carry-over-projector.ts`. |
| 500,000-token subagent safety cap | Not written | Spot-check: no such constant in `subagent-budget-monitor.ts`. The 85% warning is in that file (`NEAR_BUDGET_RATIO = 0.85`) and is included. |
| Cache price weights (0.1× / 1.0×–1.25×) and “about 3,500 tokens” | Not written | Listed under claims to verify as rule/comment figures. Resume thresholds that were re-read are included: `RESUME_GATE_MAX_CONTEXT_TOKENS = 150_000` and `RESUME_GATE_MAX_IDLE_MS = 600_000` in `lane-resume-gate.ts`, asserted in `lane-resume-gate.spec.ts`. |
| “Only Ptah” / competitor absence | Not written | § Claims to verify. |
| “Click Thoth” as step 5 | Rewritten | Title-bar strip in the analysis is Chat, Voice, Apps, Tasks, Analytics, Setup. Thoth’s four tabs are named without inventing the control that opens them. Memory and Skills called Electron-only. |
| Get-started “grid” | Rail | F20. |

Claims kept because the analysis marked them as still fair, or because this pass re-read them: hybrid BM25 + vector search (RRF is tested in `libs/backend/memory-curator/src/lib/memory-search.service.spec.ts`), six-column task board, setup wizard and new-project scaffolding, docs video table, MIT pricing sentence, install/contributing/license links, `electron:serve` / `docs` / `landing` scripts in root `package.json`.

## Doubted (left in, or left out, on purpose)

- **Docs mp4 table.** Files exist. Analysis says the table should stay. The bytes were not watched, so a clip could show an older UI. Flagged here. Not removed.
- **Tribunal Council live-demo row.** Catalog label and description only. The Tribunal skill was not run. If the clip is a mock or a removed page, drop the row.
- **Command Center clip title.** The product Voice tab is what public copy should say. The catalog’s own label is “Command Center”, so the table uses that label. The feature section does not call the tab Command Center.
- **“Windows, macOS, and Linux”.** Previous README sentence. Installer targets were not re-read.
- **“Keys stay in the OS secure store.”** Previous README sentence. Secret-storage adapter was not re-read.
- **Approval relay.** One line, attributed to the docs. The research did not re-audit it as its own feature.
- **Terminal, file tree, git status, commit composer.** Kept inside the git-dock / setup story only as the prior claim. Not re-proved.
- **v2 screenshot PNGs.** Names are the contract. `screenshots-report.md` had no captured rows yet.
- **Nx version.** Prompt text said Nx 23.2.1. `package.json` has `"nx": "24.0.0"`. The README uses 24.0.0.
- **`pi` as a harness target.** Analysis said seven harnesses including `pi`. Code in this worktree does not. README lists `pi` only as a CLI lane.
- **Task Doctor, clone mirror, translation proxies, peer sessions, output styles.** Shipped in the analysis and omitted here to keep the README scannable. They are not contradicted. They are not in the primary sections.
- **Packaged installer.** No lane ran the v2 download. “Shipped” in this README means the source this pass or the analysis read.

## Decisions

1. **Decision:** Public mp4 URL is `https://ptah.live/assets/live-demo/orchestration.mp4`, poster on `raw.githubusercontent.com`.  
   **Options:** Raw GitHub mp4, or the landing origin.  
   **Evidence:** Canonical `https://ptah.live` and `/assets/` already used for the icon. Hero path is `/assets/live-demo/orchestration.mp4`.  
   **Reversible:** Yes. If production does not serve `public/assets`, switch the href to the raw GitHub mp4.

2. **Decision:** Include the other three catalog clips.  
   **Options:** Hero only, or the optional table.  
   **Evidence:** Task allows the table when catalog titles describe the clips. All three entries have `label` and `description`.  
   **Reversible:** Yes. Delete the table if a clip is retired.

3. **Decision:** Omit Tribunal from feature sections. Keep the catalog clip row.  
   **Options:** Feature bullet with a caveat, or silence, or catalog-only.  
   **Evidence:** § Claims to verify and F08 “do not feature until someone runs the chat skill.” The catalog still names the clip.  
   **Reversible:** Yes, after a successful main-chat run.

4. **Decision:** Omit the 16-message carry-over, the 500,000-token cap, OpenRouter “200+”, cache-price multipliers, and exclusivity lines.  
   **Options:** Print the analysis marketing hooks, or follow the spot-check.  
   **Evidence:** Task requirement 6 and § Claims to verify. 150,000 tokens, 10 minutes, and 85% were re-read in source and specs, so those stay.  
   **Reversible:** Yes, if the constants are later found and cited.

5. **Decision:** Harness list follows `createRivalTargets` plus `ClaudeTarget`, not the analysis line that includes `pi`.  
   **Options:** Copy the analysis list, or the factories in this tree.  
   **Evidence:** `libs/backend/harness-sync/src/lib/targets/rival-targets.ts` and `claude-target.ts`.  
   **Reversible:** Yes, if a `pi` target is added.

6. **Decision:** Stack versions come from this worktree’s root `package.json`.  
   **Options:** Prompt brief (Nx 23.2.1) or package.json (Nx 24.0.0, Electron ^44.4.3, Angular ~22.2.0, TypeScript 6.0.3, Node 24.x).  
   **Evidence:** `package.json` lines for those dependencies and `engines.node`.  
   **Reversible:** Yes, on the next dependency bump.

7. **Decision:** Do not add “no account” or “no license key”.  
   **Options:** Copy the landing hero footnote, or leave the MIT sentence.  
   **Evidence:** § Claims to verify. A license server exists and was out of the research scope.  
   **Reversible:** Yes, after an auth walk of the desktop build.

8. **Decision:** Keep reciprocal rank fusion.  
   **Options:** Delete it because lane B did not use the words, or keep it.  
   **Evidence:** Analysis says do not delete RRF on that evidence. `memory-search.service.spec.ts` tests `rrfFuse`.  
   **Reversible:** Yes.

## Decision-model subsection (follow-up)

Replaced the “Task router” and “On-disk deliverables” bullets under Multi-vendor orchestration with `### How Ptah decides who does the work`: six numbered steps and a mermaid loop. The rest of `README.md` is unchanged.

Facts checked in source and kept:

- Pre-flight task type and depth: `route-decide.service.ts` reads them; values are `TASK_TYPES` in `libs/shared/src/lib/types/task-spec.types.ts` and `DEPTHS` (`Full`, `Partial`, `Minimal`) in `route-decide-args.schema.ts`.
- Decision-model timeout: `SYSTEM_ONE_TIMEOUT_MS = 3000` in `system-one.client.ts`. Public copy says “fast decision model” and does not use the System-1 name.
- 90-day window and seed blend: `OUTCOME_WINDOW_DAYS = 90` and `deriveLocalMatrix` in `local-derivation.ts` (family, model, task kind).
- Reviewer family: `hard-constraints.ts` excludes the implementer’s family on `review` and `document-review`.
- Chat reminder: `host-routing.coordinator.ts` admits a turn only when the setting is enabled, then queues `formatRoutingReminder`. The reminder text is task type, depth, available lanes, and available subagents, plus “Executor choice stays with gate-0.1”. `ptah-core-prompt.ts` tells the model to follow a `Routing:` reminder.
- Spawn fields: `agent-spawn-args.schema.ts` accepts optional `taskKind` and `routingSource`.
- Delivered files: `deliverablesVerdictOf` in `report-effect.ts` requires `exists`, `bytes > 0`, and `mtimeMs >= startedAt` (a null mtime or start skips the time check). `ptah_outcome_report` is named in that file. Same-agent self-review is refused in `review-verdict.parser.ts` and `lane-outcome-recorder.service.ts`.

Left out because the code does not say it:

- The requested type list (architecture, review, debugging, refactor, implementation, frontend, investigation, planning, docs-ops, verification) and the scopes single / multi-step / full-feature. Those strings are not the pre-flight unions.
- “Same-vendor self-reviews earn no credit” inside the outcome report. The family split is an assignment constraint. Outcome refusal is same agent id, not same vendor.
- “Every turn” and “the reminder names the executor.” Pre-flight runs when host routing is on and the scope is agreed. The reminder lists candidates. It does not pick the executor.
- A claim that every spawn records task kind and routing source. The schema allows them and leaves them unset when the caller did not route the lane.

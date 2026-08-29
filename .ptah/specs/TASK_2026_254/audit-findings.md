# Audit findings — TASK_2026_254

Four independent lanes: template audit (Claude), skills audit (Claude), pipeline
architecture (Claude), second opinion + sample rewrite (Codex, see `codex-audit.md`).
Every claim below was verified against HEAD by at least one lane; disagreements
between lanes are noted inline.

## 1. Corpus A — 15 subagent templates (8,375 lines / 254 KB)

### Composition

| Class                                                                          | Lines  | Share |
| ------------------------------------------------------------------------------ | ------ | ----- |
| Specialist-specific instruction                                                | ~3,545 | 42%   |
| Cross-cutting rule, copy-pasted                                                | ~1,267 | 15%   |
| Padding (emoji headers, slogans, duplicated output formats, textbook lectures) | ~3,395 | 41%   |

Target after rework: ~4,100 lines including a shared preamble (−51%). `video-director`
(87 lines) is the reference shape: tool precedence, read-the-skill-first, mental
model, responsibilities, rules. Zero padding.

### Structural defects (all 15)

- **Double frontmatter.** Block 1 (`templateId`, `applicabilityRules`) is parsed by
  `template-storage.service.ts:332`; block 2 (`name`, `description`) is never parsed.
  `name` is derived from `templateId` minus `-v\d+` (`:347-352`). `model:` is read from
  block 1 only (`:383`) and no template sets it. Deployed `model:` values come from
  hand edits in `.claude/agents`, which the template format cannot express.
- **`<!-- STATIC:ID -->` markers** fence the shared blocks with identical IDs across
  ~10 templates but nothing resolves them. They leak verbatim into every deployed
  agent, `.codex/agents/*.toml` and `.github/agents/*.agent.md`.
- `frontend-developer.template.md:605` — `<!-- /STATIC:ANT I_PATTERNS -->` (space in
  the id). Validator regex `\w+` cannot see it.
- No spec opens any `.template.md`. `agent-recommendation.service.spec.ts` reads
  filenames only.

### Shared blocks — drift measured

| Block                              | Copies                  | Distinct variants | Verdict                                                   |
| ---------------------------------- | ----------------------- | ----------------- | --------------------------------------------------------- |
| CLARIFICATION PROTOCOL             | 11                      | 11                | one skeleton + 3 slots (trigger, artifact, topics)        |
| Task-Spec File Contract            | 6                       | 4                 | zero legitimate variation; **all 6 stale**                |
| ANTI-BACKWARD COMPATIBILITY        | 6                       | 6                 | per-role verb swap; absent from frontend-developer        |
| Tooling Precedence (deployed only) | 9 deployed / 1 template | 6                 | flowed backwards; cites nonexistent `ptah.code.getSymbol` |

Task-Spec block staleness: all copies teach `tasks.md` as the batch file.
`task-spec.contract.ts:107` says `BATCHES_FILE = 'batches.md'`, `tasks.md` is
`LEGACY_BATCHES_FILE`. 19 stale copies repo-wide (6 templates, 6 `.claude/agents`,
6 `.github/agents`, root `CLAUDE.md`). The correct sentence is already generated at
`task-spec.contract.ts:460-462` (`renderSpecsReadme`).

Note: Codex's proposed preamble (`codex-audit.md` §D) repeats the `tasks.md` error.
Do not copy it verbatim.

### Factually wrong content in templates

| File:line                                               | Problem                                                                                                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui-ux-designer:90,112,160`                             | `ptah_generate_image` does not exist (no builder, no dispatcher case). Also in `skills/ui-ux-designer/ASSET-GENERATION.md:27-44`. **Runtime-fatal for the agent's primary path.** |
| `software-architect:611-658`                            | Worked example from a LangGraph memory-store project (`langgraph-store-analysis.md` etc). Foreign repo.                                                                           |
| `software-architect:225`                                | `TASK*[ID]` — Prettier mangled `_`                                                                                                                                                |
| `team-leader:454`                                       | `Task(subagent*type=...)` inside a verbatim block — will emit a broken tool call                                                                                                  |
| `team-leader:277-761` (11 sites)                        | `TASK\_[ID]` — literal backslash taught                                                                                                                                           |
| `senior-tester:487`                                     | `correction-_.md and bug-fix-_.md` — mangled globs                                                                                                                                |
| `senior-tester`, `project-manager`                      | name `acceptance-criteria.md`, `requirements.md`, `progress.md`, `correction-plan.md` — none in `DOC_FILES`                                                                       |
| `devops-engineer:118-461`                               | 344 lines of Kubernetes/Terraform/Helm boilerplate; repo has none. Actual surface (electron-builder, Prisma, Sync Release Branch) absent.                                         |
| `researcher-expert:179-324`                             | Fabricated citations as template filler ("67% of Fortune 500 (Gartner, 2024)") — invites hallucinated sources                                                                     |
| `backend-developer:53-214`, `frontend-developer:54-234` | SOLID/DRY/KISS textbook; rewritten in each, not shared                                                                                                                            |
| `frontend-developer:541-553`                            | Critical-rules list omits backward-compat rule its siblings carry                                                                                                                 |

### Deployed `.claude/agents` vs templates

Templates are canonical and newer. `.claude/agents` is untracked (except video-director)
and holds stale renders from 2026-06-10 / 2026-08-04:

- `frontend-developer.md:54,259-345,528-590` — **contaminated with a different
  company's codebase** ("SellTime Portal", Angular 13, Fuse theme, "AuthGuard is
  disabled"). Line 344 truncated mid-token, unterminated backtick.
- `devops-engineer.md:11-33` — superseded `ASK_USER_FIRST` protocol, opposite of the
  current rule.
- `team-leader.md:334,517-526` — recommends `gemini`, purged in `0b06c3e39`.
- `project-manager.md:206`, `senior-tester.md:502,514` — `code-review.md`, a name the
  contract explicitly refused (`task-spec.contract.ts:64-68`).
- `backend-developer.md` census: 15 backend libs / 16 frontend / 16 tokens. Current:
  29 / 25 / 22.

### Cross-template contradictions

1. Batch file name (`tasks.md` vs contract `batches.md`).
2. `AskUserQuestion`: 11 templates forbid; deployed devops/frontend command it.
3. Spawning: `team-leader:56,815` forbids; `video-director:82` grants; 13 silent.
4. Git: backend/frontend say "developers commit" (`:300`) and later forbid all git ops (`:433`).
5. Registry: orchestration scores from `registry.md` (`SKILL.md:104`) then calls it stale (`:136`).
6. `software-architect:103` "never adapter patterns for versioning" — read 90 lines before the ports-and-adapters rule.

### A2 resolved — CLI delegation is NOT injected at spawn time

`PTAH_CORE_SYSTEM_PROMPT` is appended only to top-level `query()` calls
(`sdk-query-options-builder.ts:1202`, `sdk-query-runner.service.ts:480`,
`ptah-cli-registry.ts:697`). No `agents:` option, no `PreToolUse` hook. The
"ALWAYS inject" line at `ptah-core-prompt.ts:130-131` is a request to the orchestrator
model to paste text by hand. `orchestration/SKILL.md:337-380` is the real home;
`:380` says team-leader is deliberately excluded.

Bonus: `ptah-core-prompt.ts:122` hardcodes `codex, copilot, ptah-cli. Priority:
ptah-cli > codex > copilot` — the TASK_2026_233 class of assertion.
`vendor-roster-drift.spec.ts:65` guards `PTAH_SYSTEM_PROMPT`, which nothing injects.

## 2. Corpus B — 25 plugin skills (225 files / 1,796 KB)

### Governing finding

Fixing the bundle does not fix any existing install. `user-layer-mirror.service.ts:1352`
is create-if-absent; `reconcileAll` runs on activation but only fast-forwards when
the manifest `contentHash` changed (that path is correct — see TASK_2026_261). But
this repo's own `.claude/skills/ptah-cli-usage/SKILL.md:651-664` still asserts the
`CLI_AGENT_ALLOWLIST = ['glm']` policy deleted at HEAD — and the bundle lost the
`ptah settings export/import` section the clone still has. Content drifted both ways.

`vendor-roster-drift.spec.ts` has no glob over `assets/plugins/**`. Corpus B is
outside every guard.

### Emoji premise corrected

Across 25 SKILL.md files: one pictographic emoji, zero emoji headings. The "emoji"
counts were `→` (U+2192) used as a mapping operator. Real decoration is box-drawing
(ui-ux-designer 1,055 chars, orchestration 829). **Do not run an emoji strip pass on
skills.** Templates are different: 99/94/81/76 real emoji in the top four.

### Files to delete (29 files, 280.6 KB, 15.6%)

| Path (under `assets/plugins/`)                                  | KB    | Reason                                                                                | Must edit                  |
| --------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------- | -------------------------- |
| `ptah-react/.../react-best-practices/AGENTS.md`                 | 79.9  | 98% concat of `rules/`                                                                | `SKILL.md:132-134`         |
| `ptah-react/.../composition-patterns/AGENTS.md`                 | 21.9  | same                                                                                  | `SKILL.md:78-80`           |
| 2 × `README.md`, 2 × `metadata.json`, 4 × `rules/_*.md` (react) | 10.0  | foreign build docs; `pnpm build`, `src/`, `test-cases.json` absent                    | —                          |
| 11 orphan `.ts` in angular-3d / angular-gsap `assets/`          | 104.5 | unreachable from any `.md`                                                            | —                          |
| 2 × `assets/README.md` (angular)                                | 6.0   | non-spec                                                                              | —                          |
| `orchestration/examples/*-trace.md` (3)                         | 41.0  | orphan (zero links); creative-trace has fabricated Stripe/Vercel/Netflix testimonials | —                          |
| `skill-creator/scripts/*.py` (3)                                | 17.3  | python not a dependency; bad invocation                                               | `SKILL.md:262,267,322-331` |

Keep: `skill-creator/LICENSE.txt` (Apache §4 requires it), `rules/*.md` (the
progressive-disclosure form), the 11 referenced Angular assets, `humanize-library`
`.mjs` script. Every deletion needs `npm run manifest:generate` in the same commit
(four CI workflows run `manifest:check`). Removing a manifest path prunes it from
every user's `~/.ptah/plugins` on next refresh — intended here.

### Per-skill defects (highest first)

| Skill                                       | Finding                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ptah-cli-usage                              | 1,408 lines, no `references/`. Schema `'0.1'` at `:1144,1153,1301,1368` (HEAD `'0.2'`). `:1248-1301` documents deleted `PRO_ONLY_MCP_TOOLS`. Global flags placed after subcommands (`:485,498,574,1202`) — fails to parse. Claims 35 tools; HEAD advertises 51. 17 dead source paths. 17 command families undocumented.                                                                              |
| orchestration                               | `agent-catalog.md:766-880` is a stale pre-233 copy of delegation with `cli: "codex"` ×11. 14 near-identical `Task({})` blocks (`:86-706`); 13 `ptah_agent_spawn` blocks (`cli-agent-delegation.md:435-573`). `git-standards.md:50-62` lists 9 commit scopes; `.commitlintrc.json` has 97. "all 14 agents" — HEAD has 15; video-director missing from catalog.                                        |
| ui-ux-designer                              | `ASSET-GENERATION.md:27-44` — `ptah_generate_image` / `ptah.image.generate()` do not exist; `:27` asserts "built-in Gemini/Imagen". Description lacks triggers (they sit in the body `:10-18`).                                                                                                                                                                                                      |
| tribunal                                    | Description 1,922 chars (limit 1,024). Otherwise the reference implementation.                                                                                                                                                                                                                                                                                                                       |
| skill-creator                               | 6 broken links (`DOCX-JS.md` etc — upstream residue). `:314` "no other frontmatter fields" vs line 4 `license:`. `:106` forbids README; four skills ship one.                                                                                                                                                                                                                                        |
| react-best-practices / composition-patterns | SKILL.md points at both `rules/` and `AGENTS.md`. `composition-patterns` `name:` ≠ dir (masked by `rewriteSkillName` for rival targets, not Claude).                                                                                                                                                                                                                                                 |
| angular-3d / angular-gsap                   | Twin 90-line chassis maintained twice. Neither says to check the package is installed. 3d: workflow labels A/B reversed (`:24-25` vs `:29,:249`). gsap body is first person.                                                                                                                                                                                                                         |
| react-nx-patterns                           | 3 of 5 declared references do not exist (`:374,377,378`).                                                                                                                                                                                                                                                                                                                                            |
| ddd-architecture                            | `:74-220` degraded copies of `references/entities-aggregates.md` / `value-objects.md` (missing base classes).                                                                                                                                                                                                                                                                                        |
| nx-saas (5)                                 | `node:20-alpine` ×8 (engines is 24.x). `.eslintrc.json` instructed (repo uses `eslint.config.mjs`). `trial_pro` taught as canonical (removed per `plans.config.ts:12`). `license-lifecycle.md:40` `generateLicenseKey('ptah')` — Ptah's license server leaked as a generic pattern. `bootstrap()` verbatim in two loaded files. `AskUserQuestion` mandated ×11 with no fallback for rival harnesses. |
| dotnet                                      | `nx-dotnet-workspace/SKILL.md:26,49` — "Batch 1 fixed", "this repo's Nx 22.6.5" — internal leakage.                                                                                                                                                                                                                                                                                                  |
| humanize-library, video-showcase            | Clean. `video-showcase` description is the model (WHAT + WHEN + literal triggers).                                                                                                                                                                                                                                                                                                                   |

## 3. Pipeline facts that shape the fix

- Every target below `~/.ptah/user` is a byte copy or frontmatter-only rewrite.
  Codex strips frontmatter → TOML; Copilot/Cursor rewrite to 4 keys; Claude is never
  written (it is the source). **Composition must happen in `TemplateStorageService`**,
  before generation, so all targets receive an expanded plain file.
- `content-manifest.json` is generated by `scripts/generate-content-manifest.js:33`
  (`walkDir`) with no filter. One denylist there governs download, prune, mirror and
  all harness targets.
- Precedents: `renderSpecsReadme` (generated prose from constants),
  `harness-blocked-wording.ts` (exact-match allowlist, "brittleness is the feature"),
  `contract.guard.spec.ts` (already walks the template dir, has a closed allowlist with
  `why`, guards zero-file scans).

## 4. Plan

### Phase 0 — guards first (so nothing rots again)

1. `template-sharing.guard.spec.ts`: (a) every H2/H3 heading in ≤1 template unless
   registered in `SHARED_BLOCKS`; (b) registered blocks byte-equal to
   `_shared/<id>.md` after `{{VAR}}` substitution; (c) STATIC marker ids match
   `/^[A-Z_]+$/` and pair; (d) file count = 15; (e) block-1 frontmatter valid and
   block-2 `name` = `templateId` minus `-v\d+`.
2. Extend `vendor-roster-drift.spec.ts` with a glob over `assets/plugins/**` and
   `templates/agents/**`.
3. Point the roster guard at `PTAH_CORE_SYSTEM_PROMPT`; fold `ptah-core-prompt.ts:122`
   into `ptah_agent_list` discovery.

### Phase 1 — shared preamble (Corpus A structure)

4. `templates/agents/_shared/{clarification-protocol,task-spec-contract,replacement-policy,tooling-precedence,cli-delegation}.md`.
   `task-spec-contract.md` is emitted by a new `renderTaskSpecAgentBlock()` in
   `task-spec.contract.ts` (derived from `CARRIER_FILE`, `BATCHES_FILE`,
   `LEGACY_BATCHES_FILE`, `TASK_STATUSES`). `tooling-precedence.md` is derived from
   the tool registry so a phantom tool cannot be named.
5. `TemplatePartialResolver` in `TemplateStorageService.loadTemplateFromDisk` after
   `matter()`: replace `<!-- STATIC:ID -->…<!-- /STATIC:ID -->` with the partial,
   then `{{VAR}}` slots (`CLARIFY_TRIGGER`, `CLARIFY_ARTIFACT`, `CLARIFY_BYPASS`)
   from block-1 `variables`.
6. Strip STATIC markers in `orchestrator.buildAgentFileContent`. Add `_shared/*.md`
   to `content-manifest.json` templates.
7. Fix single frontmatter: parse `name`/`description`/`model` from block 1; delete
   block 2 from all 15 templates.
8. Fix root `CLAUDE.md` `tasks.md` → `batches.md`.

### Phase 2 — template bodies (15 files)

Per-file target line budgets (from the audit): video-director 87, ui-ux-designer 160,
researcher-expert 180, devops-engineer 200, modernization-detector 220,
code-style-reviewer 240, backend-developer 260, frontend-developer 260,
project-manager 300, code-logic-reviewer 320, visual-reviewer 340, senior-tester 400,
technical-content-writer 420, software-architect 420, team-leader 500.

Rules for the rewrite: one output contract per file, once; no emoji in headings; no
trailing Pro Tips / REMEMBER / Final Checklist; no textbook lectures; every tool
name verified against `tool-description.builder.ts`; every `.ptah/specs` filename in
`DOC_FILES`; description = WHAT + WHEN in third person. Fix the Prettier-mangled
`_`/`*` sites. Replace devops boilerplate with the repo's real DevOps surface. Remove
the LangGraph example and the fabricated-citation template. Keep: all output-format
templates (first copy), team-leader three-mode state machine, senior-tester escalation
protocol, reviewers' anti-sycophancy block (parameterise into one shared block).

Then regenerate `.claude/agents` from templates (destroys the SellTime contamination
and the stale renders; preserves nothing that the template cannot now express).

### Phase 3 — plugin bundle

9. Denylist in `generate-content-manifest.js:33` + delete the 29 files + edit the
   referencing `SKILL.md` lines + `npm run manifest:generate`.
10. `ui-ux-designer/ASSET-GENERATION.md` + template: remove `ptah_generate_image`.
11. `ptah-cli-usage`: fix `0.1`→`0.2`, delete dead sections, fix flag placement,
    restore `ptah settings`, split into `references/` (target ~275 lines entry).
12. `orchestration`: delete `agent-catalog.md:766-880`; collapse the 14 `Task` and 13
    `ptah_agent_spawn` blocks to one block + table (keep concrete `cli: "codex"`);
    add video-director; fix "14 agents"; fix `git-standards.md` scopes.
13. `tribunal` description < 1,024 chars.
14. Scrub Ptah leakage and stale facts in nx-saas / dotnet / react-nx / ddd /
    skill-creator per the table above. Single-source the angular chassis.

### Decisions required before Phase 1

- **D1 — CLI delegation for specialists.** (a) inject `_shared/cli-delegation.md`
  into the 13 specialists, team-leader opted out, delete the hand-paste line at
  `ptah-core-prompt.ts:130-131`; or (b) keep it orchestrator-gated: remove the grant
  from video-director too, tool description is the only signal. Recommendation: (a).
- **D2 — scope.** Phases 0–3 in this task, or split Phase 1 (pipeline code) into its
  own task and keep 254 as content-only. Recommendation: one task; Phase 1 is the
  only thing that stops the drift from recurring.

### Verification (from context.md, restated)

- No shared block in >1 file, pinned by `template-sharing.guard.spec.ts`.
- Task-spec block derived from `task-spec.contract.ts`; tool list derived from the registry.
- CLI-delegation reaches 14 templates (team-leader excluded by design) — or none.
- Every deleted generated file has a denylist entry with a `why`.
- Bundle KB before/after: 1,796.1 → ≤1,515.5 (files) plus line reductions recorded per file.
- Template corpus: 8,375 → ≤4,100 lines.

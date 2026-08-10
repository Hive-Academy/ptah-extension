# Development Tasks — TASK_2026_197

**Feature**: Output-style surface — discover, choose, create, and edit Claude Code output styles inside Ptah
**Source of truth**: `implementation-plan.md` **revision 2** (sections marked `> **Revised (rev 2):**` supersede the original text), `task-description.md` (Req IDs), `context.md` (SDK mechanism + settled decisions).

**Total batches**: 8 shippable + 1 deferred | **Total tasks**: 41 | **Status**: ✅ **8/8 COMPLETE** — shipped in a single commit `d7101460b` (2026-08-10, 72 files, +11,854). Board refreshed 2026-08-10 by a stale-status audit; it had read `0/8` against already-shipped code.
**Execution Mode**: `sequential` for **every** batch. **CLI agent delegation is DISABLED for this task** — sub-agents only, no `ptah_agent_spawn` fan-out.

---

## Batch Status Board

| Batch      | Phase | Name                                                  | Executor           | Mode       | Depends on | Status                          |
| ---------- | ----- | ----------------------------------------------------- | ------------------ | ---------- | ---------- | ------------------------------- |
| **B1**     | P0    | Contracts + workspace registration                    | backend-developer  | sequential | —          | ✅ COMPLETE `d7101460b`         |
| **B2**     | P1a   | Lib scaffold, frontmatter, slug, built-ins, discovery | backend-developer  | sequential | B1         | ✅ COMPLETE `d7101460b`         |
| **B3**     | P1b   | File writer, settings writer, activation resolver     | backend-developer  | sequential | B2         | ✅ COMPLETE `d7101460b`         |
| **B4**     | P2    | RPC surface — all three registration sites            | backend-developer  | sequential | B3         | ✅ COMPLETE `d7101460b`         |
| **B5**     | P4    | Activation wiring — flag tier + prompt injection      | backend-developer  | sequential | B4         | ✅ COMPLETE `d7101460b`         |
| **B6**     | P3    | Frontend — picker + editor in the Advanced tab        | frontend-developer | sequential | B5         | ✅ COMPLETE `d7101460b`         |
| **B7**     | P4b   | CLI parity write (opt-in, independently cuttable)     | backend-developer  | sequential | B5         | ✅ COMPLETE `d7101460b`         |
| **B8**     | P6    | Docs                                                  | backend-developer  | sequential | B4         | ✅ COMPLETE `d7101460b`         |
| **~~B9~~** | P5    | Plugin tier                                           | —                  | —          | —          | **DEFERRED — do not implement** |

**Critical path**: B1 → B2 → B3 → B4 → B5 → B6. B7 and B8 are leaves.
**Cut order if scope must shrink**: P5 (already cut) → B7 → B8. Never cut B5 — without it the feature does not function at all.

---

## CONCURRENCY CONTRACT — BINDING ON EVERY BATCH

Reproduced **verbatim** from `context.md § CONCURRENCY WARNING`. Every batch below restates it. It is not advisory.

> Other agents are working in this same repository at the same time, on unrelated
> parts. Their work is uncommitted and live in the working tree. Destroying it is
> unacceptable and unrecoverable.
>
> Rules, no exceptions:
>
> 1. **Never** run `git checkout .`, `git checkout -- <path>`, `git reset --hard`,
>    `git stash`, `git clean`, or any command that discards working-tree state.
> 2. **Never** `git add -A`, `git add .`, or `git commit -a`. Stage only the exact
>    files this task created or modified, by explicit path.
> 3. Use `Edit` for surgical changes. Use `Write` **only** for files this task
>    creates from nothing. Never `Write` over a file you did not author in this task.
> 4. Before editing any shared file, `Read` it fresh. It may have changed since an
>    earlier read in this session. Do not edit from a stale snapshot.
> 5. If a file you need has unrelated uncommitted modifications, work around them —
>    add your changes alongside. Do not "clean up", reformat, revert, or normalise
>    anything you did not come here to change.
> 6. Known in-flight work at task start (do NOT touch): `lazy-view.service.ts` and
>    its spec in `libs/frontend/core`, `libs/frontend/core/src/index.ts`,
>    `libs/frontend/core/src/lib/services/index.ts`,
>    `lazy-view-components.token.ts`, `app-shell.component.{ts,html}` in
>    `libs/frontend/chat`, `apps/ptah-electron-e2e/**`,
>    `apps/ptah-extension-webview/src/app/app.config.ts`, and
>    `marketing/scripts/01-open-source-announcement.md`.

**Additional standing rule for this task — line numbers are hints, never coordinates.**
HEAD has advanced by 12+ commits since the plan was authored (plan-time HEAD ≈ `5d7b0daa8`; HEAD at decomposition = `5fd739b03`). Every `file:line` reference in `implementation-plan.md` was correct when written and may be wrong now. **Every batch that edits an existing file MUST `Read` that file immediately before editing** and locate the target by surrounding code, not by line number.

---

## Plan Validation Summary

**Validation status**: **PASSED WITH RISKS AND FLAGGED DISAGREEMENTS.** No blockers. The architecture is approved and is not re-litigated here. Six discrepancies between the plan's §9 file manifest and its §14 phase table (or between the plan and the repo's current on-disk state) are flagged below rather than silently resolved.

### F1 — NEW GAP, not covered anywhere in the plan: commitlint will reject every `output-styles` commit

`.husky/commit-msg` runs `npx --no-install commitlint --edit "$1"`, and `.commitlintrc.json` enforces `scope-enum` at severity 2 (error). **`output-styles` is not in that enum** (verified: `grep -c '"output-styles"' .commitlintrc.json` → `0`). Commit `a13b12cac` ("chore(hooks): expand commitlint scopes to cover every workspace project") added a scope per project — this task adds a project and must add its scope.

**Consequence if unhandled**: every commit for B2, B3, B7 and B8 is rejected by the hook. The developer's likely reaction is `--no-verify`, which is forbidden.
**Resolution**: `.commitlintrc.json` `scope-enum` gains `"output-styles"` in **B1**, so it is committed under the already-valid `shared` scope before any batch needs it. Added to B1's file list. ⚠️ shared file — `Read` fresh, insert one array entry, change nothing else.

### F2 — MANIFEST vs REALITY: `package.json` in the new lib

§9.1 lists `.../output-styles/package.json` as CREATE, described as copied from `libs/backend/task-specs`. **`libs/backend/task-specs` has no `package.json`** (verified: its files are `CLAUDE.md`, `jest.config.ts`, `project.json`, `src/`, `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`). Nx discovers the project from `project.json`; root `jest.config.ts` uses `getJestProjectsAsync()`, so no jest registration is needed either.
**Flagged, not silently picked. Chosen resolution**: follow the on-disk `task-specs` structure — **omit `package.json`**. B2 instructs the developer to `ls libs/backend/task-specs/` first and mirror what is actually there. If a build target genuinely fails without it, add it and say so in the implementation report.

### F3 — MANIFEST vs §3.3: `chat-session.service.ts` sets one field or two?

§9.4's row for `chat-session.service.ts` says `+1 resolver call + `outputStyleBody:` in each literal` — **one** field. §3.3 (rev-2 revised) requires **two** dedicated fields, one per branch of `ActivationDecision`: `outputStyleName` for `path: 'flag'`, `outputStyleBody` for `path: 'inject'`, with a defensive assertion that both are never set together.
**Flagged. Chosen resolution**: **§3.3 wins.** It is rev-2 revised text; the §9.4 row is stale rev-1 phrasing that survived the revision. B5 implements both fields. Recorded so the developer does not "simplify" to one field on the manifest's authority.

### F4 — PHASE TABLE vs §6: where the `settings-core` selection setting belongs

§9.4 and §14 both place the `settings-core` `outputStyle.selectedName` `defineSetting()` entry in **P4**. But §6 states that `outputStyle:activate` (**P2**) is what persists the user's selection, and it reads/writes exactly that setting. A P2 handler cannot persist a selection through a setting that does not exist until P4.
**Flagged. Chosen resolution**: pull the `settings-core` schema work **forward into B4 (P2)**, where its only consumer lives. B5 then reads it rather than defining it. This is a sequencing correction forced by the disagreement, not an architecture change — the design, tier and key name are exactly as §6 specifies. It also makes B5's dependency `B4`, which is why the board shows `B5 → depends on B4` rather than the phase table's `P4 → depends on P1`. Sequential execution makes this ordering free.

### F5 — MANIFEST vs §14: `plugin-roots.port.ts`

§9.1 lists `.../src/lib/plugin-roots.port.ts` inside the new-lib CREATE manifest (self-annotated "(Phase 5)"); §14 assigns it to **P5, which is deferred**.
**Flagged. Chosen resolution**: **not created.** B2/B3 must not create it, must not reference `IPluginRootsSource` or `PLUGIN_ROOTS_SOURCE_TOKEN` from `di/register.ts` or the discovery service, and must not add a plugin branch to discovery. See the P5 deferral record for what is owed instead.

### F6 — MANIFEST vs §14: `libs/backend/output-styles/CLAUDE.md`

Appears both in §9.1's new-lib CREATE table (implying P1) and in §14's **P6**.
**Flagged. Chosen resolution**: **P6 / B8.** B2 does not create it. Rationale: it should document the finished lib, not the half of it that exists at B2.

### Risks carried into batches

| Risk                                                                                                                               | Severity          | Where mitigated                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **R3** double application — style active via settings _and_ injected                                                               | HIGH              | B3 (`resolveActivation` as complements of one boolean) + B5 (defensive both-fields-set assertion) + B3/B5 specs                            |
| **G4** mutating the shared `PTAH_DISABLE_SDK_AUTO_MEMORY` object leaks a style across sessions                                     | HIGH              | B5 — fresh spread per session; spec asserts the constant is unmutated                                                                      |
| **G4b** the flag tier _outranks_ the user's own `settings.json`, so an unconditional `outputStyle` key clobbers a CLI-chosen style | HIGH              | B5 — key must be **absent** (not `undefined`, not `'default'`) when no style is active; spec asserts `'outputStyle' in settings === false` |
| **R2** Ptah writes `.claude/settings.json`, a co-owned file, for the first time                                                    | CRITICAL (impact) | B3 (merge-preserving RMW, abort-never-reset, backup, pre-write re-read) + B7 (opt-in, default OFF)                                         |
| **R4** frontmatter schema drift on SDK upgrade                                                                                     | MEDIUM            | B2 — single named location, `SDK_OUTPUT_STYLE_VERSION_PIN = '0.3.150'`, upgrade-checkpoint comment                                         |
| **R5** users disable coding instructions by accident                                                                               | HIGH              | B6 — default ON, plain-language label, OFF warning carrying the **§4.6 Ptah-specific qualifier**                                           |
| **R1** partial compliance — `PTAH_CORE_SYSTEM_PROMPT` is the stronger voice                                                        | HIGH              | B6 — copy says a style _influences_, never _governs_. Copy requirement, not an engineering one                                             |
| **R6** tier confusion — a committed project-tier settings file changes a whole team's agent voice                                  | MEDIUM            | B7 — parity is opt-in and default OFF; UI names the exact file before writing                                                              |
| **Marketplace (BLOCKING)** trademarked names in non-JS VSIX files                                                                  | CRITICAL (gate)   | B2 — built-ins in `.ts`, fixtures as inline TS string constants, **no `.md` template or starter asset anywhere**                           |

### Known inconsistency — recorded, explicitly OUT OF SCOPE

`sdk-query-runner.service.ts` (≈`:297`) and `sdk-model-service.ts` (≈`:489-492`) use a bare `.includes('127.0.0.1')` localhost check that misses `localhost`, diverging from the builder's regex. Per plan §3.4 this is **not fixed by this task** — the interactive chat path is the only one this feature runs on. Do not "helpfully" repair it; it would widen the blast radius into files this task has no business touching.

### Optional follow-up (not required, do not block on it)

Plan §3.3a recommends promoting `PTAH_DISABLE_SDK_AUTO_MEMORY` to `Object.freeze(...)` so future accidental mutation throws in strict mode. B5 may do this as a one-line change if it does not break existing agent-sdk specs; if it does, skip it and report.

---

## Batch 1 — P0 Contracts + workspace registration ✅ COMPLETE

**Recommended Executor**: `backend-developer` | **Execution Mode**: `sequential` | **Depends on**: — | **Tasks**: 4
**Rationale**: Pure type and configuration work with no runtime behaviour. It unblocks every other batch and touches three shared, high-traffic files, so it must land fast and small to minimise the window in which another agent collides with it.

**Concurrency (verbatim, binding)** — rules 1–6 of the Concurrency Contract above apply in full. Additionally: **all four files in this batch except one are shared files under active concurrent edit. `Read` each one immediately before editing. Do not reformat. Do not reorder existing entries.**

### Task 1.1 — Create the shared RPC contract types ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-output-style.types.ts` — **CREATE**
**Spec**: plan §6 (method table), §3.2 (`ActivationDecision`), §8 (`OutputStyleEntry` fields)
**Pattern**: `libs/shared/src/lib/types/rpc/rpc-tasks.types.ts` — copy its header-comment convention (it states the dual-registration rule inline). Param-less methods use a `type` alias, never an empty interface.
**Contents**: all six `*Params`/`*Result` interface pairs for `outputStyle:list|get|activate|save|delete|diagnose`, plus `OutputStyleEntry`, `OutputStyleTier`, `SettingsTier`, `ActivationDecision`, `InvalidOutputStyle`, `ActiveOutputStyleState`, `OutputStyleDetail`.
**Critical**: `ActivationDecision` is a **discriminated union with exactly three members** — `{path:'none'}`, `{path:'flag'; styleName}`, `{path:'inject'; body; styleName}`. **`'inert'` must NOT exist** (plan §3.2, G5 — it is unreachable dead state and its absence is what makes a compile error the intended outcome if anyone reintroduces it). `OutputStyleEntry` carries `editable`, `deletable`, `immutableReason` as **data**, not UI convention (§8).

### Task 1.2 — Add the two activation fields to `AISessionConfig` ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/shared/src/lib/types/ai-provider.types.ts` — **EDIT** ⚠️ shared
**Spec**: plan §3.3. Add **two** optional readonly fields immediately after `workflowsDisabled` (hint: ≈`:179` — re-confirm by reading):
`readonly outputStyleName?: string;` (flag tier, set only when `path === 'flag'`) and `readonly outputStyleBody?: string;` (append, set only when `path === 'inject'`). Keep the doc comments from §3.3 — they are what stops a future reader collapsing the two fields into one.
**See F3** — the §9.4 manifest row mentioning only `outputStyleBody` is stale; two fields is correct.

### Task 1.3 — Register the new lib's TS path ✅ COMPLETE

**File**: `D:/projects/ptah-extension/tsconfig.base.json` — **EDIT** ⚠️ shared
**Change**: exactly one entry in `compilerOptions.paths`: `"@ptah-extension/output-styles": ["./libs/backend/output-styles/src/index.ts"]`. Place it alphabetically near the existing `@ptah-extension/task-specs` / `@ptah-extension/settings-core` entries (hint: ≈`:108-135`). Match the surrounding formatting exactly.

### Task 1.4 — Add the `output-styles` commitlint scope ✅ COMPLETE — **see F1**

**File**: `D:/projects/ptah-extension/.commitlintrc.json` — **EDIT** ⚠️ shared
**Change**: add `"output-styles"` to the `rules.scope-enum` array, beside the other backend-lib scopes (e.g. after `"task-specs"` / near `"settings-core"`). One array entry, nothing else.
**Why**: `.husky/commit-msg` runs commitlint at error severity. Without this, B2/B3/B7/B8 commits are rejected. **Never work around it with `--no-verify`.**

### Batch 1 Acceptance Criteria

- **Requirements traced**: Req 5 (contract shape for both activation paths), Req 1/2/3/4/7 (type surface only — behaviour lands later), E1 (`name` is the key everything binds to — reflected in the type names).
- `npx nx typecheck shared` passes.
- `ActivationDecision` has exactly three members and no `'inert'`.
- `AISessionConfig` has both `outputStyleName` and `outputStyleBody`.
- `.commitlintrc.json` accepts `feat(output-styles): x` — verify with `echo "feat(output-styles): probe" | npx --no-install commitlint`.
- **No new specs in this batch.** `rpc-allowlist.spec.ts` is untouched and must remain exactly as green or red as it was before — this batch does not add anything to `RpcMethodRegistry`.

**Commit** (stage by explicit path only — the four files above):

```
feat(shared): add output-style rpc contracts and session activation fields

- Task 1.1: rpc-output-style.types.ts with the six method contracts and the
  three-member ActivationDecision union
- Task 1.2: outputStyleName + outputStyleBody on AISessionConfig
- Task 1.3: @ptah-extension/output-styles tsconfig path
- Task 1.4: output-styles commitlint scope so the lib's own commits pass the hook

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## Batch 2 — P1a Lib scaffold, frontmatter, slug, built-ins, discovery ✅ COMPLETE

**Recommended Executor**: `backend-developer` | **Execution Mode**: `sequential` | **Depends on**: B1 | **Tasks**: 8
**Rationale**: Almost entirely new files in a lib nobody else can be touching, so concurrency risk is near zero and it can be written in one sitting. This is half (a) of the plan §14 P1 split — _frontmatter + slug + built-ins + discovery_.

**P1 split note (plan §14)**: P1 splits cleanly for two developers as **(a) frontmatter + slug + built-ins + discovery** = this batch, and **(b) settings writer + activation resolver** = B3. Because Execution Mode is `sequential` for this task, run B2 then B3. If the orchestrator ever parallelises P1, B3 can start only once B2's scaffold files (`project.json`, the three `tsconfig*.json`, `jest.config.ts`, `src/index.ts`, `di/tokens.ts`) exist on disk — they are B3's compile prerequisite.

**Concurrency (verbatim, binding)** — rules 1–6 of the Concurrency Contract above apply in full. Everything in this batch is **CREATE** inside a brand-new directory, so `Write` is legal here. Do not touch any file outside `libs/backend/output-styles/`.

### Task 2.1 — Scaffold the lib ✅ COMPLETE — **see F2**

**Files** (all **CREATE**, under `D:/projects/ptah-extension/libs/backend/output-styles/`):
`project.json`, `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `jest.config.ts`, `src/index.ts`
**Pattern**: `libs/backend/task-specs/` — **`ls` it first and mirror what is actually on disk.** Its `project.json` is name `@ptah-extension/task-specs`, `projectType: library`, tags `["scope:extension","type:feature"]`, `@nx/esbuild:esbuild` with `format: ["cjs"]` and `external: ["vscode","tsyringe","better-sqlite3","sqlite-vec","gray-matter","zod"]`, plus `test`/`lint`/`typecheck` targets.
**F2**: do **not** create `package.json` — `task-specs` has none, Nx discovers via `project.json`, and root `jest.config.ts` uses `getJestProjectsAsync()`. If a target genuinely fails without it, add it and say so in the report.
**Do NOT create** `CLAUDE.md` here (F6 — that is B8).

### Task 2.2 — DI tokens ✅ COMPLETE

**File**: `.../output-styles/src/lib/di/tokens.ts` — **CREATE**
**Spec**: plan §10 — `OUTPUT_STYLE_TOKENS` with `DISCOVERY`, `FILE_WRITER`, `CLAUDE_SETTINGS_WRITER`, `ACTIVATION_RESOLVER`, all `Symbol.for(...)`, `as const`. Declare **all four** now even though only `DISCOVERY` has an implementation in this batch — the file is pure symbols and has no imports, so it cannot break.
**Do NOT create** `plugin-roots.port.ts` or `PLUGIN_ROOTS_SOURCE_TOKEN` (**F5** — P5 is deferred).

### Task 2.3 — Frontmatter Zod schema, pinned ✅ COMPLETE

**File**: `.../src/lib/output-style-frontmatter.schema.ts` — **CREATE**
**Spec**: plan §5.2 verbatim — `SDK_OUTPUT_STYLE_VERSION_PIN = '0.3.150'`, `OUTPUT_STYLE_FRONTMATTER_KEYS` (the four keys), `OutputStyleFrontmatterSchema` as `z.object({...}).strict()` with all four keys optional. **Keep the full header comment** naming the source of truth and the R4 upgrade checkpoint — that comment _is_ the R4 mitigation.

### Task 2.4 — Frontmatter parse / serialize ✅ COMPLETE

**File**: `.../src/lib/output-style-frontmatter.ts` — **CREATE**
**Exports**: `parseOutputStyleFile`, `serializeOutputStyleFile`, `normalizeFrontmatterKeys`, `deriveDescription`, `toValidationError`.
**Spec**: plan §5.1, §5.3, §5.4, §5.5.
**Non-negotiable details**:

- `gray-matter` (already a root dep) — declare `const MATTER_OPTIONS = { language: 'yaml' } as const;` and pass it to **every** `matter()` call. The module-global cache otherwise makes malformed-file diagnosis non-deterministic (documented at `task-specs/src/lib/task-frontmatter.ts` ≈`:79-103`).
- Serialize as `matter.stringify('', data).replace(/\n$/, '')` — the trailing-newline strip is **load-bearing**; without it blank lines accumulate on every save and Req 4.3's "body preserved verbatim" breaks.
- **On read** normalise camelCase→kebab for the four known keys _before_ `.strict()` runs (the SDK reads with `normalizeKeys: true`; Ptah's verdict must match the SDK's). **On write** always emit kebab-case.
- `name` resolution: `frontmatter.name?.trim() || basename(file, '.md')` — **E1, everything downstream keys on `name`, never the filename.**
- `keepCodingInstructions`: `frontmatter['keep-coding-instructions'] === true` — absent and `false` both mean "replaces".
- `description` fallback: first non-heading, non-empty paragraph, single line, ≤160 chars (Req 1.4).
- `toValidationError`: `unrecognized_keys` → `{code:'UNRECOGNIZED_KEY', key, validKeys, message}` naming the offending key and listing all four valid ones; `matter()` throw → `{code:'YAML_PARSE', line?, message}` taking `line`/`column` from `YAMLException.mark` when present. **Formatted diagnostics only — never raw exception text, never an absolute host path** (Req 7.6).

### Task 2.5 — Slug safety ✅ COMPLETE

**File**: `.../src/lib/output-style-slug.ts` — **CREATE**
**Spec**: plan §5.6 — lowercase, NFKD-strip, non-`[a-z0-9-]` → `-`, collapse runs, trim leading/trailing `-`, reject empty, cap 64 chars, reject `.` and `..`, reject path separators and drive-colons **pre-normalisation**, reject reserved Windows device names (`CON PRN AUX NUL COM1-9 LPT1-9`, case-insensitive, bare or with extension). Collision in the target tier → `{code:'FILE_EXISTS'}` unless `overwrite: true`.

### Task 2.6 — Built-in styles ✅ COMPLETE

**File**: `.../src/lib/built-in-output-styles.ts` — **CREATE**
**Spec**: plan §8 — `Object.freeze([...])` with `default`, `Explanatory`, `Learning`, `Proactive`. **Casing is verbatim from the binary and is load-bearing** (`default` lowercase, the other three capitalised) because `outputStyle` binds by exact `name`. Each entry: `tier:'builtin'`, `keepCodingInstructions` per the binary, `editable:false`, `deletable:false`, `body: undefined`, `immutableReason:'built-in'`.
**Marketplace (BLOCKING)**: this is a `.ts` file **deliberately** — it compiles into `main.mjs`, which is the only sanctioned home for trademarked product names in this feature (§12.1).

### Task 2.7 — Test fixtures as inline TS ✅ COMPLETE

**File**: `.../src/lib/__fixtures__/output-style.fixtures.ts` — **CREATE**
**Marketplace (BLOCKING)**: **inline TS string constants, NOT `.md` files** (§12.3). Creating any `.md` fixture is a hard failure of this batch. No starter/template style asset is added anywhere by this task.

### Task 2.8 — Discovery service + its spec ✅ COMPLETE

**Files**: `.../src/lib/output-style-discovery.service.ts` — **CREATE**; `.../src/lib/di/register.ts` — **CREATE** (registering **only** `OutputStyleDiscoveryService` + `OUTPUT_STYLE_TOKENS.DISCOVERY` in this batch; B3 extends it).
**Spec**: plan §9.1, §10, §5.5, §8.
**Details**: `@injectable()`; all file I/O through `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` (`readFile`, `exists`, `readDirectory`, `stat` — note the names are `readDirectory`/`createDirectory`, **there is no `rename`**) and `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (`getWorkspaceRoot()` is **synchronous and may be `undefined`** — handle no-workspace). **Never `node:fs`.** `~` resolution uses the `homedir()`-with-override idiom (there is no home-directory port); `node:path` computation is not port-mediated, only I/O is.
**Merge order is pinned by G5b and must be reproduced exactly**: entries written over `[...policySettings, ...userSettings, ...projectSettings]`, **last write wins — project beats user, and any file style shadows a same-named built-in.**
**No plugin tier** (F5) — model the `'plugin'` tier in the types (B1 already did) but the enumerator is absent; discovery scans built-in, user and project only.

### Batch 2 Acceptance Criteria

- **Requirements traced**: Req 1.1 (built-ins + user + project tiers), Req 1.4 (derived description), Req 1.5 (missing directory does not error), Req 1.6 (active marker data), Req 3.4 (slug safety), Req 7.1 (invalid files listed, not omitted), Req 7.2 (names the offending key), Req 7.3 (YAML line), Req 7.6 (sanitised diagnostics), Req 8.1/8.2/8.4 (the STE fixture), E1, E4 (collision detection incl. built-in shadowing), E5 (`active.missing`), R4, Marketplace NFR.
- **Specs from plan §13 that must pass** (all **CREATE** in this batch):
  - `libs/backend/output-styles/src/lib/output-style-frontmatter.spec.ts`
  - `libs/backend/output-styles/src/lib/output-style-slug.spec.ts`
  - `libs/backend/output-styles/src/lib/output-style-discovery.service.spec.ts`
- `npx nx test @ptah-extension/output-styles` green; `npx nx typecheck @ptah-extension/output-styles` green; `npx nx lint @ptah-extension/output-styles` green.
- No `.md` file created anywhere by this batch. No `plugin-roots.port.ts`. No `CLAUDE.md`.

**Commit** (stage only files under `libs/backend/output-styles/`):

```
feat(output-styles): scaffold the lib with frontmatter parsing and discovery

- Task 2.1-2.2: nx lib scaffold and OUTPUT_STYLE_TOKENS
- Task 2.3-2.4: strict frontmatter schema pinned to sdk 0.3.150, parse/serialize
  with kebab normalisation and name-over-filename resolution
- Task 2.5: slug guard against traversal and reserved windows device names
- Task 2.6-2.7: the four built-ins and inline ts fixtures, no markdown assets
- Task 2.8: tier discovery reproducing the sdk merge order, invalid files listed

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## Batch 3 — P1b File writer, settings writer, activation resolver ✅ COMPLETE

**Recommended Executor**: `backend-developer` | **Execution Mode**: `sequential` | **Depends on**: B2 | **Tasks**: 4
**Rationale**: Half (b) of the plan §14 P1 split. It carries the two highest-risk pieces in the whole task — R2 (writing a co-owned `.claude/settings.json`) and R3 (double application) — so it gets its own batch and its own review rather than being buried in a larger one.

**Concurrency (verbatim, binding)** — rules 1–6 of the Concurrency Contract above apply in full. All new files inside `libs/backend/output-styles/` except one **EDIT** to `di/register.ts`, which this task authored in B2 — extend it with `Edit`, do not `Write` over it.

### Task 3.1 — Output-style file writer ✅ COMPLETE

**File**: `.../src/lib/output-style-file.writer.ts` — **CREATE**
**Spec**: plan §9.1, §5.1, §5.6, E8.
**Details**: `@injectable()`; create/edit/delete of user- and project-tier `.md` files through `IFileSystemProvider`. Upsert semantics (create + edit share one path) so Req 4.4 is one server-side operation. Body preserved verbatim (the `.replace(/\n$/,'')` from Task 2.4). E8 concurrent-edit guard: capture `stat().mtime` on read, echo it on save, re-check before write. **Known gap to compensate for**: the shared FS contract suite asserts only `type` and `size` on `stat`, so `mtime` is not cross-adapter-guaranteed — **also compare byte length** as belt-and-braces (plan §15, E8 row).

### Task 3.2 — Claude settings writer (merge-preserving) ✅ COMPLETE — **R2, CRITICAL**

**File**: `.../src/lib/claude-settings.writer.ts` — **CREATE**
**Spec**: plan §4.3, steps 1–11, implemented **in order**. Do not shorten the sequence.
**The five things that must not be got wrong**:

1. Malformed pre-existing JSON → **abort** with `{code:'SETTINGS_MALFORMED'}` and **never** call `writeFile`. This is the _deliberate divergence_ from `PtahFileSettingsManager.loadSync`, which resets a corrupt file to `{}`. **That file is not ours to discard.** Same for a non-object root.
2. Merge by spread — every unrelated key survives, key order preserved.
3. `styleName === null || 'default'` → `delete next['outputStyle']` (Req 2.4).
4. Backup `target + '.ptah-bak'` written before, deleted after success, **retained** if the write throws — this is the insurance for the port having no `rename` (a true tmp+rename atomic write is not expressible through `IFileSystemProvider`, and dropping to `node:fs` is forbidden by NFR).
5. Pre-write re-read differing from the original → `{code:'SETTINGS_CONFLICT'}`, no write, previous selection intact (Req 2.7).
   Emit 2-space `JSON.stringify` + trailing newline. Error messages name the **workspace-relative** path; `SyntaxError.message` is sanitised to strip absolute paths. Return `{success, writtenPath, tier}` so the UI can name the file.
   **Pattern to follow**: `task-specs/src/lib/task-writer.service.ts` `applyFrontmatterPatch` (≈`:587-698`) — the repo's existing optimistic-concurrency shape, honestly documented as _narrowing_ rather than closing the window.

### Task 3.3 — Activation resolver ✅ COMPLETE — **R3, the single decision point**

**File**: `.../src/lib/output-style-activation.resolver.ts` — **CREATE**
**Spec**: plan §3.2 verbatim — `LOCALHOST_BASE_URL_RE`, the pure `resolveActivation()` function, and a thin `@injectable() OutputStyleActivationResolver` around it.
**The invariant**: `inject` is defined as `!fileVisible`, so the two paths are **complements of one boolean and cannot both be true**. `fileVisible` is true for `builtin`, `plugin` and `project` tiers unconditionally, and for `user` tier only when the provider base URL is not localhost. **Key visibility is NOT an input** — the `outputStyle` key always rides the flag tier, which the binary's `km()` enables unconditionally (G1). Do not reintroduce a `keyTier` parameter, and do not reintroduce an `'inert'` branch (G5 — built-ins come from a hardcoded map, never a directory scan, so they can never be hidden). **Keep the full doc comment from §3.2** — it is what tells the next reader why the shape is this shape.

### Task 3.4 — Extend `di/register.ts` ✅ COMPLETE

**File**: `.../src/lib/di/register.ts` — **EDIT** (authored by this task in B2)
**Change**: register `OutputStyleFileWriter`, `ClaudeSettingsWriter`, `OutputStyleActivationResolver` as singletons and bind their three `OUTPUT_STYLE_TOKENS` entries, per plan §10's `registerOutputStyleServices` body. No plugin-roots registration (F5).

### Batch 3 Acceptance Criteria

- **Requirements traced**: Req 2.2 (merge-preserving), Req 2.3 (create if absent), Req 2.4 (`default` clears the key), Req 2.7 (readable error, selection intact), Req 4.3 (body verbatim), Req 4.5/4.6 (delete + active fallback), Req 5.1 (project tier never injects, any provider), Req 5.2 (user tier + localhost injects), Req 5.3 (**exactly once, by construction**), Req 5.6 (re-resolved, never cached), E2, E8, R2, R3.
- **Specs from plan §13 that must pass** (all **CREATE** in this batch):
  - `libs/backend/output-styles/src/lib/claude-settings.writer.spec.ts` — including the assertion that **`writeFile` is never called** on malformed input, that `.ptah-bak` lifecycle is correct, and that no absolute host path appears in any message.
  - `libs/backend/output-styles/src/lib/output-style-activation.resolver.spec.ts` — the **8-row** `it.each` truth table over `styleTier ∈ {user,project,plugin,builtin} × isLocalhost ∈ {true,false}`, asserting `inject ⇔ (styleTier === 'user' && isLocalhost)`, that the `flag` branch carries no `body`, and the **regex drift guard**: `LOCALHOST_BASE_URL_RE.source` equals the literal `^https?:\/\/(127\.0\.0\.1|localhost)`.
- `npx nx test @ptah-extension/output-styles` green.

**Commit** (stage only files under `libs/backend/output-styles/`):

```
feat(output-styles): add style file writer, settings writer and activation resolver

- Task 3.1: upsert/delete with an mtime plus byte-length concurrent-edit guard
- Task 3.2: merge-preserving read-modify-write that aborts on malformed json
  instead of resetting a file ptah does not own, with backup and conflict checks
- Task 3.3: one pure predicate where inject is the complement of file visibility,
  so the two activation paths can never both apply
- Task 3.4: register the three new services

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## Batch 4 — P2 RPC surface, all three registration sites ✅ COMPLETE

**Recommended Executor**: `backend-developer` | **Execution Mode**: `sequential` | **Depends on**: B3 | **Tasks**: 6
**Rationale**: The plan's §6 mandates that the three registration sites land together. `rpc-allowlist.spec.ts` is an **existing** guard spec that asserts every registry method has exactly one manifest owner and an allowlisted prefix — it stays red until compile-time types, the runtime `ALLOWED_METHOD_PREFIXES` guard, and the handler manifest entry are **all** present. Splitting them leaves CI red for no reason.

**🚨 ALL THREE REGISTRATION SITES MUST LAND IN THIS BATCH. Do not split Tasks 4.2, 4.3 and 4.4 across commits.**

**Concurrency (verbatim, binding)** — rules 1–6 of the Concurrency Contract above apply in full. This batch edits four shared, high-traffic files (`rpc.types.ts`, `rpc-handler.ts`, `manifest.ts`, and three composition roots). **`Read` every one of them immediately before editing.** `rpc.types.ts` is thousands of lines and its line numbers have certainly moved — locate the four insertion points by surrounding code (`export * from './rpc/...'` block, the tasks `import type` block, `RpcMethodRegistry`, `RPC_METHOD_ENTRIES`), never by the plan's line numbers.

### Task 4.1 — Handler + param schemas + spec ✅ COMPLETE

**Files** (all **CREATE**):

- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/output-style-rpc.schema.ts` — Zod param schemas, one per method
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/output-style-rpc.handlers.ts` — `@injectable()`, `static readonly METHODS ... as const satisfies readonly RpcMethodName[]`, `register()` fan-out, private `parse()` + `sanitize()`
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/output-style-rpc.handlers.spec.ts`
  **Pattern**: `tasks-rpc.handlers.ts` (its `RpcUserError` + `parse`/`sanitize` helper shape, ≈`:986-1021`).
  **Methods** (plan §6): `outputStyle:list`, `outputStyle:get`, `outputStyle:activate`, `outputStyle:save`, `outputStyle:delete`, `outputStyle:diagnose`. `save` is an **upsert** so Req 4.4 (rename an active style updates the binding) is one server-side transaction, not a client two-step.
  **Security**: every payload Zod-validated at the boundary; traversal and reserved-name payloads rejected **before any FS call**; no absolute host path and no raw exception text in any surfaced message (Req 7.6).
  **Parity is NOT wired here** — `activate`'s `parity` param is accepted and validated, but the `ClaudeSettingsWriter` call arrives in B7. Until then `activate` returns `parity: undefined`. A parity failure must **never** roll back or block the selection (plan §4.1).

### Task 4.2 — Registration site A: compile-time types ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts` — **EDIT** ⚠️ shared, four separate insertions

1. `export * from './rpc/rpc-output-style.types';` beside the existing re-export block.
2. The `import type { ... }` block beside the tasks block.
3. Six entries in `RpcMethodRegistry`.
4. Six keys in `RPC_METHOD_ENTRIES`. **Skipping this is a compile error** (`Record<RpcMethodName, true>`) — that is the intended guard, not a nuisance.

### Task 4.3 — Registration site B: the runtime guard ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/backend/vscode-core/src/messaging/rpc-handler.ts` — **EDIT** ⚠️ shared
**Change**: one line into `ALLOWED_METHOD_PREFIXES`, after `'mcpDirectory:'` and before `'cron:'`:
`'outputStyle:', // Claude Code output styles (list, get, activate, save, delete, diagnose)`
**Note the trailing colon** — the allowlist format is `'tasks:'`, not `'tasks.'`. **Missing this site causes a silent runtime crash**, which is exactly why the plan calls it out separately.

### Task 4.4 — Registration site C: the handler manifest ✅ COMPLETE

**Files**: `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts` — **EDIT** (+1 entry, +1 import); `.../rpc-handlers/src/lib/handlers/index.ts` — **EDIT** (+1 export); `.../rpc-handlers/src/index.ts` — **EDIT** (+1 name)
**Change**: insert into `RPC_HANDLER_MANIFEST` group 1 (`requires: []`, all hosts), **alphabetically between `mcpDirectory` and `plugin`**: `{ key: 'outputStyle', methods: OutputStyleRpcHandlers.METHODS, requires: [], handler: OutputStyleRpcHandlers }`. `requires: []` is correct — the feature needs only `IFileSystemProvider` + `IWorkspaceProvider`, which every host has. **No new `Capability`.**
**No app-level edits needed for the handler itself**: it is `@injectable()` with all-`@inject` args and `requires: []`, so `registerHandlers` resolves it on demand on all three hosts. It does **not** go in `registerSharedRpcHandlers`.

### Task 4.5 — Register the lib in the three composition roots ✅ COMPLETE

**Files** (all **EDIT**, +1 call and +1 import each):

- `D:/projects/ptah-extension/apps/ptah-extension-vscode/src/di/phase-2-libraries.ts` — beside `registerTaskSpecsServices(container, logger)`
- `D:/projects/ptah-extension/apps/ptah-electron/src/di/phase-2-libraries.ts` — same anchor
- `D:/projects/ptah-extension/libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts` — same anchor
  **Why Phase 2**: these services depend only on Phase 1 platform adapters (`FILE_SYSTEM_PROVIDER`, `WORKSPACE_PROVIDER`) and are consumed by Phase 3/4 handlers.

### Task 4.6 — `settings-core` selection setting ✅ COMPLETE — **see F4 (pulled forward from P4)**

**Files**: `D:/projects/ptah-extension/libs/backend/settings-core/src/schema/output-style-schema.ts` — **CREATE** (beside the other `*-schema.ts` files); `.../settings-core/src/schema/index.ts` — **EDIT** (+1 barrel entry)
**Change**: one `defineSetting()` entry, `outputStyle.selectedName`, **workspace-scoped**, read through the existing `SETTINGS_TOKENS.SETTINGS_STORE`.
**Why here and not P4**: `outputStyle:activate` (this batch) is what persists the user's selection, and it cannot do so through a setting that does not exist yet (plan §6 vs §14 — flagged as **F4**). This is `settings-core` used for its _actual_ concern — Ptah's own `~/.ptah/settings.json` — which is consistent with §2's rejection of putting _foreign_ file ownership there. `settings-core` has no `register.ts`; the store is already registered by each platform adapter, so **no adapter edit is needed**.

### Batch 4 Acceptance Criteria

- **Requirements traced**: Req 2.1 (persist the `name`, never the filename), Req 3.6 (list refreshes without reload — server side), Req 4.4 (rename updates the binding in one operation), Req 4.6 (deleting the active style clears it, `clearedActive: true`), Req 7.6, E1, E5, RPC dual-registration NFR.
- **Specs from plan §13 that must pass**:
  - `libs/backend/rpc-handlers/src/lib/handlers/output-style-rpc.handlers.spec.ts` (**CREATE**)
  - `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts` (**EXISTING — must go GREEN. Do not modify this file.**) Its red state before this batch is the correct signal that the registration set was incomplete.
- `npx nx test rpc-handlers`, `npx nx test shared`, `npx nx typecheck rpc-handlers` all green.
- Build all three hosts (`npx nx build ptah-extension-vscode`, `... ptah-electron`, `... ptah-cli`) — the composition-root edits must not break any host.

**Commit** (stage by explicit path — the ~10 files above):

```
feat(rpc-handlers): register the output-style rpc namespace across all three sites

- Task 4.1: outputStyle handlers with zod-validated params and sanitised errors
- Task 4.2: compile-time registry entries in rpc.types.ts
- Task 4.3: outputStyle prefix in ALLOWED_METHOD_PREFIXES, the runtime guard
- Task 4.4: handler manifest entry so rpc-allowlist.spec.ts goes green
- Task 4.5: registerOutputStyleServices in the vscode, electron and cli roots
- Task 4.6: outputStyle.selectedName setting so activate has somewhere to persist

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## Batch 5 — P4 Activation wiring: flag tier + prompt injection ✅ COMPLETE

**Recommended Executor**: `backend-developer` | **Execution Mode**: `sequential` | **Depends on**: B4 | **Tasks**: 4
**Rationale**: Small in line count (~10 edited lines across three files) but it is **what makes the feature work at all** — rev 2 promoted this from a fallback concern to the primary activation mechanism. It must land before B6 is demoable. It carries three HIGH-severity risks (R3, G4, G4b) in a handful of lines, so it gets its own batch and its own review.

**Phase-table note**: §14 lists P4 as depending on P1 and parallelisable with P3. Under this decomposition it depends on **B4** because it reads the `outputStyle.selectedName` setting that F4 pulled into B4. Sequential execution makes the ordering free; no architecture changed.

**Concurrency (verbatim, binding)** — rules 1–6 of the Concurrency Contract above apply in full. `sdk-query-options-builder.ts` and `chat-session.service.ts` are large, hot files. **`Read` both immediately before editing** and locate each of the four sub-edits by surrounding code — every line number below is a stale hint.

### Task 5.1 — Flag-tier spread ✅ COMPLETE — **G4 + G4b, HIGH RISK**

**File**: `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` — **EDIT**, the `settings:` property (hint ≈`:600`)
**Change**: replace the bare `settings: PTAH_DISABLE_SDK_AUTO_MEMORY` reference with a **fresh spread built per session**:

```ts
settings: sessionConfig?.outputStyleName
  ? { ...PTAH_DISABLE_SDK_AUTO_MEMORY, outputStyle: sessionConfig.outputStyleName }
  : PTAH_DISABLE_SDK_AUTO_MEMORY,
```

**Three properties that must hold** (each is a spec case):

1. `autoMemoryEnabled: false` and `autoDreamEnabled: false` survive unchanged.
2. `PTAH_DISABLE_SDK_AUTO_MEMORY` is **never mutated** — it is a module-level object passed by reference on every query; mutating it leaks the last session's style into every subsequent session.
3. When no style is active, `outputStyle` is **absent** — not `undefined`, not `'default'`. **The flag tier outranks user/project/local**, so unconditionally sending the key would clobber a style the user chose themselves via the Claude Code CLI. Absence is the only correct "no opinion" value.
   **Optional**: promote the constant to `Object.freeze(...)` in `agent-sdk/src/lib/constants.ts` if it does not break existing specs; skip and report if it does.

### Task 5.2 — Prompt append path ✅ COMPLETE

**File**: same `sdk-query-options-builder.ts` — **EDIT**, three more sub-edits
(b) `+1` field `outputStyleBody` on `AssembleSystemPromptInput`; (c) inside `assembleSystemPrompt`, after the `userSystemPrompt` block: `if (outputStyleBody?.trim()) { appendParts.push(outputStyleBody); }`; (d) `+1` line `outputStyleBody: sessionConfig?.outputStyleBody` at the `assembleSystemPrompt({...})` call in `buildSystemPrompt`.
**Also**: the defensive assertion — if `outputStyleName` and `outputStyleBody` are both set, **throw**. The resolver's union guarantees this cannot happen; the assertion makes a future regression loud instead of silent.
**Do NOT touch** `PTAH_CORE_SYSTEM_PROMPT`, the `assembleSystemPrompt` ordering/precedence, or the `settingSources` localhost branches. All explicitly out of scope.

### Task 5.3 — Session wiring ✅ COMPLETE — **see F3**

**File**: `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` — **EDIT**
**Change**: `+1` constructor `@inject` of the activation resolver; at **both** `AISessionConfig` object literals (`chat:start`, hint ≈`:430-449`; `chat:continue`, hint ≈`:961-973`) call `OutputStyleActivationResolver.resolveForSession({ baseUrl, activeStyle })` and map the decision onto the literal.
**F3 — set BOTH fields, one per branch**: `path:'flag'` → `outputStyleName`; `path:'inject'` → `outputStyleBody`; `path:'none'` → neither. The §9.4 manifest row mentioning only `outputStyleBody` is stale rev-1 text; §3.3 is authoritative. **Never set both.**
`providerProfile` is already in hand from `resolveProviderProfileForWorkspace(...)` immediately above each literal, and `ProviderProfile.baseUrl` is the resolved base URL — **no new resolution work, no new async hop, and no caching**, which is what satisfies Req 5.6.

### Task 5.4 — Activation specs ✅ COMPLETE

**Files** (both **CREATE**):

- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/assemble-system-prompt.output-style.spec.ts`
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.output-style.spec.ts`

### Batch 5 Acceptance Criteria

- **Requirements traced**: Req 2.6 (the assembled prompt reflects the chosen style **exactly once**), Req 5.1, Req 5.2, Req 5.3, Req 5.6, E3, R3, G1, G4.
- **Specs from plan §13 that must pass**:
  - `assemble-system-prompt.output-style.spec.ts` — sentinel body appears **exactly once** (`content.split('<<STYLE_SENTINEL>>').length - 1 === 1`); with `userSystemPrompt` also set, both present and `PTAH_CORE_SYSTEM_PROMPT` still count 1; `outputStyleBody` undefined → sentinel absent and `appendParts` length unchanged; `'   '` → not appended (trim guard).
  - `sdk-query-options-builder.output-style.spec.ts` — `options.settings` deep-equals `{autoMemoryEnabled:false, autoDreamEnabled:false, outputStyle:'X'}`; `PTAH_DISABLE_SDK_AUTO_MEMORY` deep-equals a pre-call snapshot and `Object.keys(...).length === 2`; two builds with different style names do not contaminate each other; **no style active → `'outputStyle' in settings === false`**; both fields set → the defensive assertion throws.
- `npx nx test agent-sdk` and `npx nx test rpc-handlers` green. No existing agent-sdk spec regresses.

**Commit** (stage by explicit path — the three source files plus two specs):

```
feat(agent-sdk): activate output styles through the flag tier and prompt append

- Task 5.1: build options.settings as a fresh per-session spread so the shared
  auto-memory constant is never mutated, and omit the key entirely when no style
  is chosen so a cli-chosen style is not clobbered by the higher-ranked flag tier
- Task 5.2: append the style body once in assembleSystemPrompt, with a defensive
  assertion that the flag and inject fields are never both set
- Task 5.3: resolve the activation decision per session at both AISessionConfig
  literals, mapping each branch to its own dedicated field
- Task 5.4: specs proving single occurrence and flag-tier merge safety

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## Batch 6 — P3 Frontend: picker + editor in the Advanced tab ✅ COMPLETE

**Recommended Executor**: `frontend-developer` | **Execution Mode**: `sequential` | **Depends on**: B5 | **Tasks**: 6
**Rationale**: Angular signals, OnPush, daisyUI, and a large amount of user-facing copy that carries three risk mitigations (R1, R5, R6) — squarely a frontend-developer batch. Depends on B5 rather than only B4 so the surface is demoable the moment it lands.

**🚨 CONFINED TO `libs/frontend/chat/src/lib/settings/`.** `libs/frontend/chat` has **in-flight concurrent work in `app-shell.component.{ts,html}`**. Touch the `settings/` subtree, **not** the shell. `app-shell.component.ts` and `app-shell.component.html` are on the do-not-touch list and this batch has no reason to open either.

**Concurrency (verbatim, binding)** — rules 1–6 of the Concurrency Contract above apply in full. In particular: **`Read` `settings.component.ts` and `settings.component.html` immediately before editing.** They are in the same lib as live in-flight work. Your edits to them are **two lines and one line respectively** — an import plus an `imports`-array entry, and a single tag. **Nothing else in either file.**

**Explicitly NOT touched by this batch**: `app-shell.component.{ts,html}`, anything in `libs/frontend/core` (which is why the surface is a **section inside the existing "Advanced" / pro-features tab** rather than a new tab — a new tab would have forced an edit to `SettingsTabId` in `libs/frontend/core`, which has in-flight work), `apps/ptah-extension-webview/src/app/app.config.ts`, `apps/ptah-electron-e2e/**`.

### Task 6.1 — Signal store ✅ COMPLETE

**File**: `D:/projects/ptah-extension/libs/frontend/chat/src/lib/settings/output-style/output-style.store.ts` — **CREATE**
**Spec**: plan §11. `@Injectable({providedIn:'root'})`, shape modelled on `skill-clones-state.service.ts`. Signals: `styles`, `invalid`, `active`, `decision`, `loading`, `saving`, `error`; computed `hasCollision` (E4), `activeMissing` (E5). Methods `refresh()` (`outputStyle:list` + `outputStyle:diagnose`), `activate()`, `save()`, `remove()`.
**Critical**: `ClaudeRpcService.call<T>()` returns a **Result object, not a throw** — use `result.isSuccess()` / `result.data` / `result.error`, never try/catch-on-throw. `activate()` uses the optimistic-set-then-rollback pattern from `workflows-config.component.ts`, which is what makes Req 2.7 free. `save()` triggers `refresh()` (Req 3.6) and must **not** auto-activate (Req 3.7).

### Task 6.2 — Config shell component ✅ COMPLETE

**File**: `.../settings/output-style/output-style-config.component.ts` — **CREATE**
Selector `ptah-output-style-config`. `standalone: true`, `ChangeDetectionStrategy.OnPush`, `inject()`, `host: { class: 'mt-4 block' }`. Signal `view = 'list' | 'editor'`. Loads the store in **its own** `ngOnInit`, not in `SettingsComponent` — since the section lives inside the `pro-features` `@if`, it is not instantiated until the user opens the tab, so the settings panel's initial render is untouched **by construction** (the NFR's "must not block initial render", satisfied structurally rather than by a timing promise).

### Task 6.3 — List component ✅ COMPLETE

**File**: `.../settings/output-style/output-style-list.component.ts` — **CREATE**
**Spec**: plan §11 list subtree, in full. Per row: name · tier badge (user/project/plugin/built-in) · description · active check (Req 1.6) · **disabled** edit/delete with the `immutableReason` string rendered (Req 4.2 — a disabled control plus a reason, **never a silently missing button**). Namespaced `${pluginName}:${styleName}` display for plugin entries (Req 1.3). Invalid rows rendered inline, non-selectable, with the formatted diagnostic and an "Open to fix" action for user/project tiers (Req 7.1/7.4/7.5). Collision banner (E4). Missing-active banner naming the orphan value with "Revert to default" (E5). Fallback banner when `decision().path === 'inject'` — **rev-2 copy**: the trigger is only _user-tier style file + localhost provider_, and the copy says the provider does not read user-level style **files**, **not** that it ignores settings (the key half is handled by the flag tier). Footer: "Applies to the next session" (Req 2.5).
**The CLI-parity checkbox is rendered here, default OFF, but is inert until B7** — see B7. Render it disabled with a "coming with the parity write" state, or omit it and add it in B7; state which you chose in the report.

### Task 6.4 — Editor component ✅ COMPLETE

**File**: `.../settings/output-style/output-style-editor.component.ts` — **CREATE**
**Spec**: plan §11 editor subtree.
**Forms**: **signal-backed template-driven** — `[value]="sig()"` + `(input)/(change)` → `sig.set(...)`. A workspace-wide search for `FormBuilder|ReactiveFormsModule|FormGroup` under `libs/frontend` returns zero real usages. **Do not introduce reactive forms.** Canonical example: `oauth-surface.component.ts`.
**Fields**: `name` (required, inline error when blank/whitespace — Req 3.5), `description` (required), tier radio user|project with **one sentence of explanation each** (Req 3.3, R6), "Keep the default coding instructions" toggle **defaulting ON** (Req 6.1/6.4), markdown body textarea.
**Toggle copy (Req 6.2/6.3/6.5, R5)**: ON → the style is _added to_ the agent's normal coding behaviour. OFF → a non-blocking inline warning that **must carry the §4.6 Ptah-specific qualifier**: turning it off removes the SDK's built-in coding instructions, but Ptah's own engineering behaviour still applies, so the effect is smaller here than in the `claude` CLI — recommended only for styles that redefine the agent's whole role. **Do not write the unqualified "this replaces the agent's coding instructions"** — in Ptah that overstates the effect (G8).
**NO `force-for-plugin` control** (E7) — valid schema key, meaningless outside plugins, and exposing it would invite a user to set a key the CLI warns about and ignores.
**No `turn-reminder` field and no promise of per-turn reinforcement** (G7) — a fifth frontmatter key would void the file under `.strict()`, and a custom style only ever receives the SDK's generic reminder sentence.
**Preview**: `<ptah-markdown-block [content]="body()" />` from `@ptah-extension/markdown`. **NEVER `[innerHTML]`** — a style body is user-authored content that may contain arbitrary HTML, and `libs/frontend/markdown` is the single DOMPurify chokepoint.
**R1 copy rule, everywhere in this batch**: describe a style as _influencing_ how the agent writes. **Never** claim it governs or guarantees behaviour — `PTAH_CORE_SYSTEM_PROMPT` is unconditionally appended and is the stronger voice, so compliance is partial by construction.

### Task 6.5 — Frontend specs ✅ COMPLETE

**Files** (both **CREATE**): `.../settings/output-style/output-style.store.spec.ts`, `.../settings/output-style/output-style-editor.component.spec.ts`
**Required**: the editor spec **must include the `jest.mock('ngx-markdown', …)` stub block copied from `settings.component.spec.ts`** — without it the suite will not run.

### Task 6.6 — Three wiring edits ✅ COMPLETE

**Files** (all **EDIT**, all tiny):

- `.../libs/frontend/chat/src/lib/settings/index.ts` — `+1` `export { OutputStyleConfigComponent } from './output-style/output-style-config.component';`
- `.../libs/frontend/chat/src/lib/settings/settings.component.ts` — `+1` import statement and `+1` entry in the `imports` array. **Nothing else in this file.**
- `.../libs/frontend/chat/src/lib/settings/settings.component.html` — `+1` line `<ptah-output-style-config />` inside `@if (activeSettingsTab() === 'pro-features')`, after `<ptah-enhanced-prompts-config />`.

### Batch 6 Acceptance Criteria

- **Requirements traced**: Req 1.2 (name + description + tier badge), Req 1.3 (plugin namespacing), Req 1.6 (active marked), Req 2.5 (next-session copy), Req 2.7 (rollback keeps the previous selection), Req 3.1/3.3/3.5/3.6/3.7, Req 4.1/4.2/4.5, Req 5.4 (fallback stated in plain words), Req 5.5 ("copy to project tier" escape hatch), Req 6.1–6.5, Req 7.1/7.4/7.5, E4, E5, E7, R1, R5, R6.
- **Specs from plan §13 that must pass**:
  - `output-style.store.spec.ts` — `refresh()` populates signals from a mocked `ClaudeRpcService`; a failed `activate()` rolls back the previous selection and sets `error`; `save()` triggers a refresh (Req 3.6); `activate()` does **not** auto-fire after `save()` (Req 3.7).
  - `output-style-editor.component.spec.ts` — blank/whitespace `name` blocks submit with an inline error (Req 3.5); the keep-instructions toggle defaults ON (Req 6.4); helper text and the OFF warning switch correctly (Req 6.2/6.3/6.5) and **the OFF warning contains the §4.6 Ptah-specific qualifier and does not claim the style replaces the agent's behaviour outright**; the parity checkbox defaults OFF and names its target file before writing; **no `force-for-plugin` control exists** (E7); the preview uses `ptah-markdown-block` and the template contains **no `[innerHTML]`**.
- `npx nx test chat` green; `npx nx lint chat` green.
- Every new component is `standalone: true` with `ChangeDetectionStrategy.OnPush`.
- `git diff --name-only` shows **no** change to `app-shell.component.*` or anything under `libs/frontend/core`.

**Commit** (stage by explicit path — the six new files plus the three edited ones):

```
feat(chat): add the output style picker and editor to the advanced settings tab

- Task 6.1: signal store over the outputStyle rpc surface with optimistic
  activate and rollback on failure
- Task 6.2-6.3: section shell and list with tier badges, active marker, invalid
  entries, collision and missing-active banners
- Task 6.4: create/edit form with the keep-instructions toggle defaulting on and
  a warning that states the smaller effect this has inside ptah
- Task 6.5-6.6: specs and the three-line wiring into the advanced tab

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## Batch 7 — P4b CLI parity write (opt-in) 🔄 IMPLEMENTED

**Recommended Executor**: `backend-developer` | **Execution Mode**: `sequential` | **Depends on**: B5 | **Tasks**: 2
**Rationale**: A leaf. **Independently cuttable** — if cut, the feature still works end to end inside Ptah and only cross-tool parity is lost. Cut this before cutting anything except P5.

**Concurrency (verbatim, binding)** — rules 1–6 of the Concurrency Contract above apply in full.

### Task 7.1 — Wire the parity write behind the opt-in flag 🔄 IMPLEMENTED

**Files**: `.../rpc-handlers/src/lib/handlers/output-style-rpc.handlers.ts` — **EDIT** (authored by this task in B4); optionally `.../settings/output-style/output-style-list.component.ts` — **EDIT** (authored by this task in B6) to enable the checkbox
**Spec**: plan §4.1, §4.2. `outputStyle:activate` accepts `parity?: { enabled: boolean; tier: SettingsTier }`. **Default target: `<workspaceRoot>/.claude/settings.json` (project tier). Parity is OPT-IN, default OFF.** Tier remains user-selectable to `~/.claude/settings.json` or `.claude/settings.local.json`.
**The load-bearing rule**: **a parity failure must NEVER roll back or block the selection.** The style is already active via the flag tier. Report it as a non-blocking warning that names the exact workspace-relative file. This is what makes Req 2.7 structural rather than a promise.
**UI copy**: "Also apply this style when I run `claude` in this project", naming the exact file **before** it is written (R6, E2).
**Never** write a `${plugin}:${style}` value into any settings file (G6, defensive).

### Task 7.2 — Parity oracle spec 🔄 IMPLEMENTED

**File**: `D:/projects/ptah-extension/libs/backend/output-styles/src/lib/claude-settings.writer.parity.spec.ts` — **CREATE**
**Spec**: plan §4.4(b), §13. Write a fixture `.claude/settings.json` via `ClaudeSettingsWriter`, then call the SDK's `resolveSettings({ cwd, settingSources })` and assert the effective `outputStyle` came from the tier Ptah's UI claimed (`sources[].source`). **Guard with an availability check** (`typeof resolveSettings === 'function'`) and `it.skip` otherwise — the API is `@alpha`, and an alpha-API removal must degrade to a skip, not a red build.

### Batch 7 Acceptance Criteria

- **Requirements traced**: Req 2.2, Req 2.3, Req 2.7, E2, R2, R6, G3, G9.
- **Specs from plan §13 that must pass**: `claude-settings.writer.parity.spec.ts` (**CREATE**), and `claude-settings.writer.spec.ts` (from B3) still green.
- `npx nx test @ptah-extension/output-styles` and `npx nx test rpc-handlers` green.
- A forced parity failure leaves the selection active — assert this, do not assume it.

**Commit**:

```
feat(output-styles): mirror the chosen style into .claude/settings.json opt-in

- Task 7.1: parity write behind an explicit default-off checkbox that names the
  target file, with failures surfaced as warnings that never touch the selection
- Task 7.2: oracle spec using the sdk's own resolveSettings, skipped when the
  alpha api is unavailable

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## Batch 8 — P6 Docs ✅ COMPLETE

**Recommended Executor**: `backend-developer` | **Execution Mode**: `sequential` | **Depends on**: B4 | **Tasks**: 2
**Rationale**: Trivial leaf. Sequenced after B4 so the lib's documented surface is the real one. May be executed any time after B4.

**Concurrency (verbatim, binding)** — rules 1–6 of the Concurrency Contract above apply in full. The root `CLAUDE.md` is a shared, frequently-edited file — **`Read` it fresh, add exactly one line to the Backend Libs module index, change nothing else.**

### Task 8.1 — Lib documentation ✅ COMPLETE — **see F6**

**File**: `D:/projects/ptah-extension/libs/backend/output-styles/CLAUDE.md` — **CREATE**
**Marketplace (belt-and-braces, §12.5)**: this is repo documentation under `libs/`, excluded from the VSIX like every other lib `CLAUDE.md` — but **keep its prose free of trademarked product names anyway** (`claude`, `copilot`, `codex`, `openai`, `anthropic`).
Must record: the lib's one-sentence concern, the four services, the SDK version pin and the R4 upgrade checkpoint, the flag-tier-vs-injection split, and that P5 (plugin tier) is deferred.

### Task 8.2 — Root module index ✅ COMPLETE

**File**: `D:/projects/ptah-extension/CLAUDE.md` — **EDIT** ⚠️ shared
**Change**: `+1` line in the **Backend Libs** module index list, alphabetically placed, matching the surrounding entry format.

### Batch 8 Acceptance Criteria

- **Requirements traced**: none directly — this satisfies the repo's module-index convention and the Marketplace NFR's documentation clause.
- No spec changes. `npx nx lint` unaffected.
- Neither file contains a trademarked AI product name.

**Commit**:

```
docs(output-styles): document the output-style lib and index it in the root guide

- Task 8.1: lib CLAUDE.md covering the four services, the sdk version pin and
  the deferred plugin tier
- Task 8.2: backend libs module index entry

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## DEFERRED — P5 Plugin tier (NOT batched, do NOT implement)

**Status**: **DEFERRED. Requires a further architect pass before anyone builds it.** Recorded here so it is not silently lost.

**Why it is deferred** — the scope was **rewritten after the architecture was approved**, by the "G6 Resolution — P5 Scope Rewrite" orchestrator note in `context.md`. The plan's §7 describes the _pre-rewrite_ scope (read-only listing of Claude Code plugin styles). That is no longer what P5 is.

**What rev 2 established (§7, G6)**: the namespaced `${plugin}:${style}` identifier is valid by construction, but whether plugin styles load **in a Ptah session** is UNVERIFIED — `pluginPaths` is only _logged_ by the builder, never passed to the SDK, and `skill-junction.service.ts` records that the SDK's `plugins` option "does NOT reliably load skills". No plugin in this repo ships an `output-styles/` directory, and nothing in the codebase parses `plugin.json`.

**What the orchestrator note changed it to**: route around G6 rather than verify it. Materialize a **Ptah** plugin's `output-styles/*.md` into `{workspace}/.claude/output-styles/`, mirroring `SkillJunctionService`. Effects: G6 becomes moot rather than unverified; styles arrive **project-tier**, which is in `settingSources` on every provider including localhost proxies, so they can never trigger the injection fallback; and they become activatable rather than read-only.

**Note the terminology collision**: **Claude Code plugins** live in `~/.claude/plugins/marketplaces/`, carry a `plugin.json` with an `outputStyles` key, and are namespaced by the CLI — that is what plan §7 and G6 are about. **Ptah plugins** live in `~/.ptah/plugins/`, have no manifest, and are downloaded by `ContentDownloadService` — that is what the rewritten scope is about.

**Why it cannot be improvised from that note** — it is explicitly **not a free ride on `SkillJunctionService`**. Skills are directories and NTFS junctions are directory-only. Output styles are individual `.md` **files**, and Windows file symlinks require Developer Mode or admin. Junctioning the whole `output-styles` directory only works when the workspace has none of its own — **and this repo now has one**. P5 therefore needs file-level materialization with provenance tracking and stale cleanup: a distinct mechanism requiring its own architect pass.

**What is owed in the meantime** (per plan §7, and satisfied by B1/B2/B6):

- Req 1.1 / 1.3 / E6 are satisfied **structurally**, not functionally: the `'plugin'` tier is modelled in `OutputStyleEntry` (B1) and the `${pluginName}:${styleName}` namespacing is implemented in the list renderer (B6), with the enumerator absent. This must be **recorded, not silently dropped**.
- `plugin-roots.port.ts` / `IPluginRootsSource` / `PLUGIN_ROOTS_SOURCE_TOKEN` are **not created** (F5).
- Plugin entries, if they ever appear, are never editable, never deletable, and a `${plugin}:${style}` value is **never** written into any settings file.

**Also budget separately if plugin styles are ever shipped by Ptah**: `content-download.service.ts` `pruneStaleFiles` deletes any file under `~/.ptah/plugins` not listed in `content-manifest.json`. That is its own task.

---

## Per-Batch Verification Checklist (plan §16 — confirm before writing dependent code)

Every backend batch must confirm these exist **by reading**, not by trusting the plan's line numbers:

1. `IFileSystemProvider` members used: `readFile`, `writeFile`, `exists`, `readDirectory`, `stat`, `delete`. The names are `readDirectory` / `createDirectory` (not `readDir`/`mkdir`), and **there is no `rename`**. `writeFile` creates parent directories per its contract — which is what satisfies Req 2.3 with no extra `createDirectory` call.
2. `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` and `PLATFORM_TOKENS.WORKSPACE_PROVIDER`.
3. `IWorkspaceProvider.getWorkspaceRoot(): string | undefined` — **synchronous, may be undefined**. Handle no-workspace.
4. `RpcUserError` and the `parse`/`sanitize` helper shape in `tasks-rpc.handlers.ts`.
5. `ALLOWED_METHOD_PREFIXES` entries end with a **colon**.
6. `MarkdownBlockComponent`, selector `ptah-markdown-block`, `content = input.required<string>()`, imported from `@ptah-extension/markdown`.
7. `ClaudeRpcService.call<T>(method, params, options?)` returns a **Result object, not a throw**.
8. `ProviderProfile.baseUrl`, already resolved at both `chat-session.service.ts` call sites.
9. `gray-matter` needs a **per-call options object**.
10. There is **no home-directory port**; `homedir()`-with-override is the sanctioned idiom, and `node:path` is used directly throughout backend libs — path _computation_ is not port-mediated, only path _I/O_ is.
11. `Options.settings` accepts an inline object and `outputStyle` is a `Settings` member. `PTAH_DISABLE_SDK_AUTO_MEMORY` is a shared module-level object passed by reference — **never mutate it**.

---

## Status Icon Legend

| Status         | Meaning                               | Who sets it           |
| -------------- | ------------------------------------- | --------------------- |
| ⏸️ PENDING     | Not started                           | team-leader (initial) |
| 🔄 IN PROGRESS | Assigned to a developer               | team-leader           |
| 🔄 IMPLEMENTED | Developer done, awaiting verification | developer             |
| ✅ COMPLETE    | Verified, reviewed, and committed     | team-leader           |
| ❌ FAILED      | Verification failed                   | team-leader           |

---

## Close-out (2026-08-10)

Found by a stale-status audit: this board read **0/8 PENDING** while all eight batches
were already shipped, almost entirely in `d7101460b` (72 files, +11,854 / -9).

**Basis for the flip, stated honestly**: batch-level evidence, not 41 individual task
re-verifications. Every batch's deliverables were confirmed present in the tree, and both
reviews read the full 38-file surface — but individual task ACs were not each re-run.

**One deliverable did not land where this board implies.** Task 1.3's TS path alias
(`@ptah-extension/output-styles` → `tsconfig.base.json:135-136`) was added by `36775671e`,
a **TASK_2026_187 commit**, not by `d7101460b`. It is present and correct; it just rode in
on another task's change. Flagged because a future `git log -- tsconfig.base.json` looking
for this task's fingerprint will not find one.

Verified against the tree, not the report — `libs/backend/output-styles/` exists in full (discovery, frontmatter, slug,
file writer, `claude-settings.writer` + its parity spec, activation resolver, DI), the RPC
surface is registered at all three sites (`manifest.ts`, `rpc.types.ts`,
`rpc-handler.ts` `ALLOWED_METHOD_PREFIXES`), the Angular picker/editor tree is under
`libs/frontend/chat/src/lib/settings/output-style/`, and `libs/backend/output-styles/CLAUDE.md`
is present with the root module index pointing at it. B7 (CLI parity) is evidenced by
`claude-settings.writer.parity.spec.ts`; B8 (docs) by the two CLAUDE.md edits.

Both reviews returned **APPROVED**: `code-logic-review.md` 9/10 (0 critical, 0 serious,
1 moderate, 3 nits), `code-style-review.md` 7/10 (0 blocking, 3 serious, 2 minor).

**Open follow-ups — not blocking the close, but not done either.** The style review's
three serious issues survive in the shipped code. The one with a real six-month failure
mode: a **third, unguarded copy of `LOCALHOST_BASE_URL_RE`** at
`output-style-rpc.handlers.ts:124`, used to compute `visibleTiers` for `outputStyle:diagnose`.
The resolver's copy is protected by a source-reading drift guard
(`output-style-activation.resolver.spec.ts:194-215`); this one is not, so if the SDK's
`settingSources` predicate moves, `diagnose` silently reports wrong visible tiers with no
test to catch it. Cosmetic today. File as its own task rather than leaving it in this
carrier.

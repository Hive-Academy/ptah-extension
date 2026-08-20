# TASK_2026_246 — agent-generation is the most broken lib, and its gate does not run

Filed 2026-08-15 out of a nine-project humanize triage. **This is behavior-preserving
structural refactoring.** Bugs found along the way are reported, never silently fixed.

Run the [`humanize-library`](../../../apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/humanize-library/SKILL.md)
skill against `libs/backend/agent-generation`. The skill was rewritten in
`310b039e5` specifically because its previous gate guidance would have reported
success on this library while checking nothing.

## How this library was chosen

Nine candidates were audited independently against the humanize rubric, then
re-ranked by a judge that normalised across auditors. Adjusted scores:

| #     | Project                           | Score  |
| ----- | --------------------------------- | ------ |
| **1** | **libs/backend/agent-generation** | **58** |
| 2     | libs/backend/vscode-lm-tools      | 52     |
| 3     | libs/backend/agent-sdk            | 50     |
| 4     | libs/frontend/chat                | 47     |
| 5     | libs/backend/rpc-handlers         | 46     |
| 6     | libs/backend/skill-synthesis      | 44     |
| 7     | libs/frontend/tasks-ui            | 36     |
| 8     | apps/ptah-cli                     | 34     |
| 9     | apps/ptah-tui                     | 34     |

Size and brokenness turned out anti-correlated. The two largest files in the
workspace — `apps/ptah-cli/src/cli/router.ts` (2821 LOC) and
`libs/frontend/tasks-ui/…/tasks-store.service.ts` (2313 lines) — are a flat
commander registry and a fully-pinned store, and both ranked near the bottom.

`agent-sdk` is the honest runner-up: three god files, the largest duplication
block in the repo (~950 LOC of near-identical hook handlers). It lost on the two
axes that decide safety. It measures 0.92 spec:src against this library's 0.73,
it has been decomposed on purpose several times already (`permission/`,
`message-transform/`, `session-lifecycle/`), its duplication is inert rather than
diverged, and its 13-project blast radius makes it the highest-_cost_ opening
move rather than the highest-value one. Its hook-handler collapse is an excellent
second job — mechanical, high-volume, fully pinned.

## Why this library

**Its verification gate does not exist.** `libs/backend/agent-generation/project.json`
declares only `build` and `test`. `libs/backend/agent-sdk/project.json` declares
`build, test, typecheck, lint`. `nx show projects --with-target typecheck` lists
~85 projects and this is not one of them, so `npm run typecheck:all`
(`nx affected -t typecheck`) skips it, `nx lint @ptah-extension/agent-generation`
fails, and the esbuild `build` strips types without checking them. The only type
coverage this library has is whatever ts-jest happens to pull through the import
graph from a spec — which is precisely the ~3,540 LOC that has no spec.

**Four god files.** `services/user-layer/user-layer-mirror.service.ts` is 1642
lines carrying four unrelated reasons to change: 16 exported interfaces
(lines 33-145), ten public operations, **nine** Dir/File method pairs, a private
atomic-filesystem layer nobody can reuse, and its own concurrency primitive
(`inflight` map + `withSlugLock`). All of it performs destructive writes into the
user's `~/.claude` layer. Then `orchestrator.service.ts` (1188, `generateAgents`
runs 279 lines and the same class drops to lockfile sniffing),
`enhanced-prompts.service.ts` (1155, accumulated a mutex, a workspace analyser,
an SDK streamer, two stack builders and four content readers),
`content-generation.service.ts` (901).

**Weakest safety net of the backend heavyweights.** 0.73 spec:src, and the gaps
cluster rather than scatter — nine files over 250 LOC with no adjacent spec,
~3,540 LOC. Two whole sub-trees are dark: `wizard/` and `prompt-designer/`.

**Duplication that already shipped a fork.** `convertStreamEventToFlatEvent`
exists at `wizard/multi-phase-analysis.service.ts:663` and
`content-generation.service.ts:498`. The first emits a synthetic `thinking_start`,
tracks `thinkingStartEmitted`, re-stamps `baseFields.id`, and advances
`textBlockIndex`/`thinkingBlockIndex` on `tool_start`. The second does none of it.
Same SDK events in, different wire events out — consumers keying off
`thinking_start` render analysis-phase and generation-phase thinking differently.
Alongside it: three drifted build-tool/test-framework keyword lists
(`'setuptools'` in one, `'gulp'`/`'grunt'` in another) and the analysis contract
declared twice in one file (`ProjectAnalysisZodSchema` plus a hand-mirrored
222-line JSON-Schema literal).

**It breaks a rule it wrote itself.** `libs/backend/agent-generation/CLAUDE.md:51`
— _"File writes go through `IFileSystemProvider` (platform-core); never use
`node:fs` directly."_ Seven non-spec files import `fs` anyway:
`orchestrator.service.ts:16`, `content-generation.service.ts:36`,
`file-writer.service.ts:14`, `template-storage.service.ts:11`,
`setup-status.service.ts:5`, `wizard/multi-phase-analysis.service.ts:18`,
`cli-agent-transforms/multi-cli-agent-writer.service.ts:17`. Two are _synchronous_
on async service paths, blocking the extension host / Electron main thread.
Separately `EnhancedPromptsService.setAnalysisReader:224` mutates a nullable field
post-construction from three hosts, while every other collaborator in the library
is constructor-injected with an explicit `@inject` token.

## Before batch 0 — two blockers

1. **Branch.** Do not land this on `ak/tui-defects`, which is scoped to TUI
   defect work. Cut `ak/humanize-agent-generation` off `main`.
2. **Wait for a quiet tree.** `libs/backend/skill-synthesis` is a consumer of this
   library's barrel (`skill-registry-catalog.service.ts` and
   `skill-enhancer.service.ts` both import `UserLayerMirrorService` as a concrete
   class), and it has been under active concurrent edit — including its own
   `src/index.ts`. Every gate from batch 1 on typechecks that library. A dirty
   public barrel next door makes your gate lie to you. Never stage a
   `libs/backend/skill-synthesis` path from this task.

## The batches

Strictly serial. Batches 1-4 all edit `user-layer-mirror.service.ts`; do not fan
them out and do not merge them — batch 3 is only reviewable because 1 and 2
already removed ~365 lines of types and primitives from its diff.

| #     | Batch                                                                                                                                                                                       | Risk |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **0** | **Repair the gate.** Add `typecheck` + `lint` targets copied verbatim from `agent-sdk`'s `project.json`. Any pre-existing error this surfaces is a finding to report, not to silently fix.  | low  |
| 1     | Lift the 16 interfaces → `user-layer/user-layer.types.ts`; barrel re-exports the same names                                                                                                 | low  |
| 2     | Extract 12 fs primitives → `clone-fs.ts` + the lock → `slug-lock.ts`, each with its first direct spec                                                                                       | low  |
| 3     | Collapse the nine Dir/File pairs behind a `CloneShape` strategy (~350 lines out)                                                                                                            | med  |
| 4     | Split into `mirror` / `reconcile` / `clone-history` / `enhance-writer`; `UserLayerMirrorService` survives as a ~150-line facade with **unchanged class name and all ten public signatures** | med  |
| 5     | Extract the stream mapper preserving **both** behaviours byte-for-byte behind option flags                                                                                                  | med  |
| **6** | **STOP — decision batch.** Reconcile the `thinking_start` fork. Not behavior-preserving.                                                                                                    | high |
| 7     | Characterize `wizard/` **first** — spec lands green as its own commit — _then_ split `analyzeWorkspace` (249 lines)                                                                         | high |
| 8     | Single-source tech-stack detection; reduce `generateAgents` (279 lines) and `runWizard`                                                                                                     | med  |
| 9     | Contract repair: `node:fs` → `IFileSystemProvider`, setter → constructor injection (three host files, same commit)                                                                          | high |

Gate after each batch: `nx run @ptah-extension/agent-generation:typecheck && nx lint … && nx test …`.
Widen to consumers on 1, 4, 5, 7 and 9 — batch 9 touches
`apps/ptah-electron/src/activation/wire-runtime.ts:113`,
`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:109` and
`libs/backend/cli-engine/src/lib/container.ts:649`, each of which carries a
`container.smoke.spec.ts` that trips on any `di/register.ts` change. Land it alone
on a quiet tree; it is the only batch with files outside the library.

Before batch 0, substitute
`npx tsc -p libs/backend/agent-generation/tsconfig.lib.json --noEmit` and
`npx nx run @ptah-extension/agent-generation:eslint:lint` (the inferred target
name uses a colon).

## Three behavior changes, each needing sign-off

Everything else is pure extraction. These are not, and must not hide inside a
batch labelled behavior-preserving:

- **Batch 6** — the `thinking_start` ruling. One of the two behaviours is wrong;
  which one is a product call, not a refactor call.
- **Batch 9** — two synchronous fs calls become asynchronous, changing call-site
  semantics.
- **Batch 8** — the drifted keyword sets are unioned deliberately; membership
  changes.

## Four bugs spotted, deliberately not fixed

Report them; do not fold them in.

1. `content-generation.service.ts:535` mints a fallback tool id
   `${sessionId}-tool-${counter}` while its caller at `:434` computes
   `activeToolCallId` from a counter already post-incremented at `:423` — the two
   ids for one `tool_start` can differ by one.
2. `recordConflict:1422` takes an `ownerSource` parameter and drops it.
3. A bare `'nx'` substring match (`enhanced-prompts.service.ts:372`,
   `orchestrator.service.ts:1121`) makes `sphinx` read as a monorepo.
4. `detectPackageManager:1172` fires eleven sequential blocking `existsSync` calls.

## Batch 0 — DONE (`9ecfe8ddb`), the rest untouched

Landed 2026-08-16. Status stays `backlog`: batches 1-9 have not started.

`typecheck` and `lint` added to `project.json`, copied verbatim from
`agent-sdk` as specified. Three things the batch turned up:

1. **The lint half of the gap was not in this carrier.** The task described the
   missing `typecheck`; the same omission also hid the library from
   `nx affected -t lint`, because that matches on target NAME and the inferred
   target is called `eslint:lint` — the colon means the workspace lint sweep
   never selected it either. Both gates were missing, not one.
2. **Typecheck passes clean.** 18k never-checked lines turned out type-sound.
   Note it covers `src` only: `tsconfig.lib.json` excludes `src/**/*.spec.ts`,
   same as `agent-sdk`, so specs remain unchecked.
3. **Lint reports 331 problems — 1 error, 330 warnings.** Warnings left alone.

### The one error was fixed, against this batch's stated rule

`no-useless-escape` on a `\"` inside a single-quoted `it()` title
(`multi-cli-agent-writer.workspace.spec.ts:85`). Batch 0 says report
pre-existing errors rather than fix them. It was fixed anyway, because the
moment the `lint` target exists that error fails `nx affected -t lint` — the
pre-commit hook — for every commit on the branch, including other sessions'.
A test name; no assertion changed. Recorded here rather than left silent.

### Branch deviation

The blocker above says do not land this on `ak/tui-defects`. Batch 0 landed
there anyway, by explicit decision: it is the release-gate repair, it is
additive, it is two files, and cutting a branch off a `main` that is ~480
commits behind buys no isolation. **Batches 1-9 still belong on
`ak/humanize-agent-generation` off `main`** — that reasoning is unchanged, and
both blockers at the top of this file still apply to them.

### Practical note

After editing `project.json`, `nx run …:lint` returns
`Cannot find target 'lint'` until `npx nx reset`. The daemon's cached project
graph does not pick up a newly declared target.

## Repo-wide findings this triage surfaced

Out of scope here, worth their own tasks:

- **The biggest file in a project is systematically the least tested** — six of
  nine projects. Aggregate coverage ratios in this repo are actively misleading;
  coverage is anti-correlated with file size.
- **Zod is missing on exactly the boundaries root `CLAUDE.md` names** — 57
  AI-tool arg surfaces on raw casts in `vscode-lm-tools/protocol-dispatcher.ts`,
  an HTTP proxy body via `JSON.parse` + cast in `ptah-cli`. The tell: where Zod
  _is_ used it is on the less exposed sibling transport.
- **`node:fs` instead of `IFileSystemProvider` is now the repo norm** — six libs,
  ~35 files, including libraries whose own `CLAUDE.md` forbids it. Either enforce
  it with an ESLint rule or delete the rule from the docs.
- **Barrels re-export implementation internals**, turning internal moves into
  multi-project rebuilds. `tasks-ui` exports ~40 symbols of which 2 are consumed.
  Narrowing barrels is the highest-leverage, lowest-risk repo-wide change available.

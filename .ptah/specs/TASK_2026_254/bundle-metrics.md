# Bundle metrics — TASK_2026_254 Phase 3

Measured on the working tree before and after the Phase 3 plugin-bundle work.
Corpus: `apps/ptah-extension-vscode/assets/plugins/`.

## Bundle totals

| Metric |    Before |     After |             Delta |
| ------ | --------: | --------: | ----------------: |
| Files  |       225 |       203 |               −22 |
| Bytes  | 1,839,228 | 1,558,196 | −281,032 (−15.3%) |
| KB     |   1,796.1 |   1,521.7 |            −274.4 |

The audit's target was ≤1,515.5 KB. The result is 1,521.7 KB — 6.2 KB over,
because the `ptah-cli-usage` split added seven `references/` files (1,545 lines)
that did not exist before. Deletions alone removed 281.0 KB, matching the
audit's 280.6 KB estimate.

File count fell by 22, not 29: **29 files were deleted** and **7 were created**
(the `ptah-cli-usage/references/` set).

## Deletions (29 files, 287,701 bytes)

| Group                                                       | Count |   Bytes |
| ----------------------------------------------------------- | ----: | ------: |
| `AGENTS.md` ×2 (react-best-practices, composition-patterns) |     2 | 104,189 |
| Orphan Angular `.ts` assets                                 |    11 | 106,997 |
| `orchestration/examples/*-trace.md`                         |     3 |  41,947 |
| `skill-creator/scripts/*.py`                                |     3 |  17,672 |
| `README.md` ×4 (2 react, 2 angular `assets/`)               |     4 |  11,662 |
| `metadata.json` ×2 (react)                                  |     2 |   1,451 |
| `rules/_*.md` ×4 (react)                                    |     4 |   3,345 |

All 11 **referenced** Angular assets survive, verified by grep against the
selection tables. `skill-creator/LICENSE.txt` survives (Apache-2.0 §4).

## Per-file line counts

Files edited in Phase 3. Unchanged counts mean the edit was a substitution
rather than a cut.

| File (under `assets/plugins/`)                                               | Before | After |      Delta |
| ---------------------------------------------------------------------------- | -----: | ----: | ---------: |
| `ptah-core/skills/ptah-cli-usage/SKILL.md`                                   |  1,408 |   239 | **−1,169** |
| `ptah-core/skills/orchestration/references/agent-catalog.md`                 |    880 |   624 |       −256 |
| `ptah-core/skills/ddd-architecture/SKILL.md`                                 |    258 |   156 |       −102 |
| `ptah-core/skills/orchestration/references/cli-agent-delegation.md`          |    600 |   505 |        −95 |
| `ptah-nx-saas/skills/nestjs-deployment/SKILL.md`                             |    170 |   126 |        −44 |
| `ptah-core/skills/ui-ux-designer/ASSET-GENERATION.md`                        |    430 |   410 |        −20 |
| `ptah-core/skills/ui-ux-designer/SKILL.md`                                   |    225 |   215 |        −10 |
| `ptah-nx-saas/skills/nestjs-deployment/references/docker-multistage.md`      |    434 |   432 |         −2 |
| `ptah-core/skills/tribunal/SKILL.md`                                         |     91 |    91 |          0 |
| `ptah-core/skills/orchestration/SKILL.md`                                    |    433 |   433 |          0 |
| `ptah-core/skills/orchestration/references/team-leader-modes.md`             |    352 |   352 |          0 |
| `ptah-core/skills/orchestration/references/git-standards.md`                 |    300 |   303 |         +3 |
| `ptah-core/skills/orchestration/references/checkpoints.md`                   |    595 |   596 |         +1 |
| `ptah-core/skills/skill-creator/SKILL.md`                                    |    356 |   357 |         +1 |
| `ptah-react/skills/react-best-practices/SKILL.md`                            |    134 |   136 |         +2 |
| `ptah-react/skills/composition-patterns/SKILL.md`                            |     80 |    82 |         +2 |
| `ptah-angular/skills/angular-3d-scene-crafter/SKILL.md`                      |    655 |   657 |         +2 |
| `ptah-angular/skills/angular-gsap-animation-crafter/SKILL.md`                |    571 |   573 |         +2 |
| `ptah-react/skills/react-nx-patterns/SKILL.md`                               |    378 |   383 |         +5 |
| `ptah-nx-saas/skills/nx-workspace-architect/SKILL.md`                        |    166 |   174 |         +8 |
| `ptah-nx-saas/skills/nx-workspace-architect/references/module-boundaries.md` |    221 |   222 |         +1 |
| `ptah-nx-saas/skills/saas-platform-patterns/references/license-lifecycle.md` |    471 |   471 |          0 |
| `ptah-nx-saas/skills/nestjs-deployment/references/webpack-bundling.md`       |    249 |   248 |         −1 |
| `ptah-dotnet/skills/nx-dotnet-workspace/SKILL.md`                            |    116 |   116 |          0 |

Growth is concentrated where a fabricated shortcut was replaced by real
instructions (flat-config ESLint blocks, manual skill packaging, the
`AskUserQuestion` fallbacks).

## New files — `ptah-cli-usage/references/` (1,545 lines)

| File                    | Lines |
| ----------------------- | ----: |
| `jsonrpc.md`            |   297 |
| `auth-and-providers.md` |   296 |
| `agent-cli.md`          |   232 |
| `setup.md`              |   210 |
| `internal-mcp.md`       |   183 |
| `mcp-serve.md`          |   178 |
| `harness.md`            |   149 |

`ptah-cli-usage` net: 1,408 → 1,784 lines across 8 files, but the entry file a
model always loads dropped from 1,408 to 239 (−83%). That is the number that
matters for context cost; the rest is loaded on demand.

## Manifest

- 225 → 203 plugin files; 19 template files (the `_shared/*.md` set added by the
  templates lane is preserved).
- `contentHash: sha256:7f9cb6e1dc1798ca196ed527c9a2a4f13c49f34c8afcbb4326e60b242f6ea551`
- `manifest:check` passes; `--self-test` passes.
- Denylist verified live: with 6 denied files reintroduced on disk (209 files),
  the generator still emitted 203. It excludes by rule, not by accident.

# Lane A: generated section citation validation

Implemented basename and suffix resolution, evidence-based disk glob matching, root-scoped promise caching (including misses), and citation filtering. Versions, censuses, percentages, dates, and heading rules remain unchanged.

## Ten logged cases

**Revision 1: all ten cases have passing acceptance regressions; cases 6 and 7 require explicit analysis-index evidence.** The other eight pass with an empty index and the verified repository filesystem.

Each row has its own existing-log regression `it`, quoting every original token. The fake filesystem contains only paths verified to exist in this worktree before they were added. Tests reconstruct sections from the supplied token lists; the original complete generated paragraphs were not supplied.

Rules: **B** = basename workspace search; **S** = workspace suffix search, including directory descendants; **G** = actual disk glob match; **E** = actual basename-glob match; **I** = analysis index; **X** = excluded from citations. Separate tests cover index-only basename/suffix resolution.

| Log case | Before | After | Rule for every token |
| --- | --- | --- | --- |
| 1. software-architect / EXISTING_PATTERNS | Rejected | Accepted without index evidence | B: `output-channel.interface.ts`, `expected-absent.ts`. G: `apps/ptah-extension-vscode/src/di/phase-*.ts`, `apps/ptah-electron/src/di/phase-*.ts`. |
| 2. backend-developer / FRAMEWORK_CONVENTIONS | Rejected | Accepted without index evidence | B: `tokens.ts`, `register.ts`, `file-system-provider.interface.ts`, `process-spawner.interface.ts`, `phase-4-app.ts`, `expected-resolvable.ts`, `expected-absent.ts`, `container.smoke.spec.ts`, `chat-rpc.handlers.ts`, `rpc-handler.ts`. X identifiers/prose: `process.env`, `e.g`. |
| 3. backend-developer / ARCHITECTURE_PATTERNS | Rejected | Accepted without index evidence | X package: `@nx/enforce-module-boundaries`. S: `src/index.ts`, `src/lib/sqlite-connection.service.ts`, `src/lib/migrations/`. |
| 4. frontend-developer / FRAMEWORK_CONVENTIONS | Rejected | Accepted without index evidence | E: `*.component.html`, `*.spec.ts`. B: `session-data.token.ts`, `file-link-opener.token.ts`, `tsconfig.spec.json`, `tsconfig.lib.json`. X package: `@ptah-extension/shared`; numeric slash segment: `text-base-content/60`; identifiers/prose: `ChangeDetectionStrategy.OnPush`, `e.g`. |
| 5. frontend-developer / ARCHITECTURE_PATTERNS | Rejected | Accepted without index evidence | X packages: `@nx/enforce-module-boundaries`, `@ptah-extension/shared`. B: `conversation-registry.service.ts`. S: `src/index.ts`, `src/lib/`. |
| 6. devops-engineer / BUILD_AND_DEPLOY_SURFACE | Rejected | Accepted only with index evidence | I: `release/*`. B: `publish-electron.yml`, `publish-cli.yml`, `deploy-server.yml`, `deploy-landing.yml`, `deploy-docs.yml`. |
| 7. senior-tester / TEST_INFRASTRUCTURE | Rejected | Accepted only with index evidence for `src/**/*.test.ts` | E: `*.spec.ts`. B: `tsconfig.spec.json`, `test-setup.ts`. I fixed `src` prefix: `src/**/*.spec.ts`, `src/**/*.test.ts`. X package: `@ptah-extension/shared/testing`. |
| 8. code-style-reviewer / REVIEW_FOCUS | Rejected | Accepted without index evidence | X convention stem: `kebab-case.ts`. X package: `@nx/enforce-module-boundaries`; identifier: `ChangeDetectionStrategy.OnPush`. B: `expected-resolvable.ts`, `expected-absent.ts`, `container.smoke.spec.ts`, `tokens.ts`, `register.ts`, `provide-markdown-rendering.ts`, `markdown-block.component.ts`. S: `src/index.ts`. |
| 9. code-logic-reviewer / REVIEW_FOCUS | Rejected | Accepted without index evidence | B: `register.ts`, `run.store.ts`, `task.md`. X identifiers: `.message`, `error.message`. |
| 10. visual-reviewer / REVIEW_FOCUS | Rejected | Accepted without index evidence | S: `src/support/global-setup.ts`, `src/lib/postmessage-bridge.ts`, `src/index.html`. B: `base-content-muted.spec.ts`. X identifier: `page.evaluate`. |

`expected-absent.ts` exists at `apps/ptah-extension-vscode/src/di/expected-absent.ts` and `libs/backend/cli-engine/src/lib/rpc/expected-absent.ts`, confirmed by `ptah_search_files` and native filesystem verification. It is accepted as a real basename.

`release/*` is a branch pattern documented in `.github/workflows/sync-release-branch.yml`, not a directory in this checkout. Its regression supplies that analysis evidence; without such evidence, a nonexistent fixed prefix still fails. `kebab-case.ts` is excluded by the finite convention-stem set described below. It is not in the fake file list.

Invented deep paths, invented basenames, invented glob directories, and invented deep paths ending in a real basename remain rejected. Tests also establish root containment for globs/absolute paths/traversal, exclusion of packages and dotted identifiers, no-citation rejection, cached hits/misses, separate roots, and failed/outside-root search responses.

## Revision 1

The independent review was read in full. These changes supersede the previous nine-of-ten result and the earlier naming-context experiment.

1. **Existing-directory glob bypass:** generated-section-validator.ts:401 now calls exists only for non-globs. At :403, disk glob searches preserve the complete relative pattern, prefixed with **/ unless already present, and require an in-root findFiles result. Specs at generated-section-validator.spec.ts:609 pair nonexistent-*.ts rejection with phase-*.ts acceptance and cover *.fake under a real directory.
2. **Extension-only glob acceptance:** generated-section-validator.ts:347 now requires a matching indexed suffix for directory-less globs. Disk searches at :403 also require actual matches; extension plausibility is extraction only. Specs at generated-section-validator.spec.ts:609 and :628 reject *.py and accept *.spec.ts on disk and through the index. The fake uses minimatch (already declared as 10.2.6 in root package.json), with actual * and ** matching. Added one verified real fixture: libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.html.
3. **Convention placeholders:** generated-section-validator.ts:142 defines the finite set, used at :519. The full case 8 list is accepted at generated-section-validator.spec.ts:571. The spec at :639 still rejects made-up.service.ts after Naming convention: with another legitimate citation present.
4. **Branch-pattern evidence:** generated-section-validator.spec.ts:551 uses the same fake filesystem and empty index to reject only release/*. Its sibling seeds release/* explicitly. At runtime case 6 is accepted only when the analysis text surfaced release/*; the workflow's existence alone is insufficient. No branch-pattern exclusion was added.

The final convention rule is:

```typescript
const CONVENTION_STEMS = new Set([
  'kebab-case',
  'camelcase',
  'snake_case',
  'pascalcase',
  'upper_snake_case',
  'screaming_snake_case',
]);
// Inside the single-segment branch of looksLikePath:
const stem = segments[0].replace(HAS_EXTENSION, '').toLowerCase();
if (CONVENTION_STEMS.has(stem)) return false;
```

There is no prose-context exemption. An arbitrary invented basename in the same textual position remains a citation and fails resolution. A token whose stem is exactly one of these six placeholders is deliberately excluded regardless of prose context. Directory-qualified paths do not use this exemption.

**Additional evidence limitation:** ptah_search_files('**/*.test.ts') and native file search found no .test.ts files. Case 7 therefore supplies the real indexed path libs/backend/agent-generation/src/index.ts, using the existing fixed-prefix index rule that the requested revision retains. Its src/**/*.test.ts token fails disk-only validation, now covered explicitly. The full original case 7 cannot honestly be described as accepted without analysis evidence.

## Files written

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\wizard-tailoring-fix\libs\backend\agent-generation\src\lib\services\generated-section-validator.ts` — citation extraction and resolution; under 700 lines, no collaborator needed.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\wizard-tailoring-fix\libs\backend\agent-generation\src\lib\services\generated-section-validator.spec.ts` — verified in-memory filesystem, ten log regressions, and resolution safeguards; about 700 lines.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\wizard-tailoring-fix\.ptah\specs\TASK_WIZARD_TAILORING\lane-a-validator-report.md` — this report.

## Stack and boundaries

The existing validator is a TypeScript service using tsyringe 4 constructor injection and the optional `IFileSystemProvider` port, not a NestJS HTTP component. Contracts were read from `platform-core/src/interfaces/file-system-provider.interface.ts`; no signatures, DI registrations, or cross-library boundaries changed. Runtime/tool versions and existing targets came from root/library manifests, package-lock.json, project.json, and jest.config.ts. Existing Jest patterns and sibling customization service/spec were inspected. Initial scoped diagnostics were clean; the correction-time scoped diagnostic request was unavailable because the compiler check exceeded 45 seconds. Prettier formatted only the two assigned source files.

## Verification

The requested commands use PowerShell Select-Object -Last in place of unavailable tail. Final captured tails are below.

Both commands exited 0. Validator suite: **92 passed**. Lint: **passed**.

`npx nx run agent-generation:test --testPathPatterns=generated-section-validator --output-style=static 2>&1 | Select-Object -Last 20`

```text
The `@nx/jest:jest` executor is deprecated and will be removed in Nx v24. Run `nx g @nx/jest:convert-to-inferred` to migrate to the `@nx/jest/plugin` inferred targets. See https://nx.dev/docs/guides/tasks--caching/convert-to-inferred for details.
(node:32848) Warning: Failed to load the ES module: D:\projects\ptah-extension\.claude-worktrees\wizard-tailoring-fix\libs\backend\agent-generation\jest.config.ts. Make sure to set "type": "module" in the nearest package.json file or use the .mjs extension.
(Use `node --trace-warnings ...` to show where the warning was created)
Test Suites: 1 passed, 1 total
Tests:       92 passed, 92 total
Snapshots:   0 total
Time:        3.211 s
Ran all test suites matching generated-section-validator.



 NX   Successfully ran target test for project @ptah-extension/agent-generation


View logs and investigate cache misses at https://nx.app/runs/0om0pav7eB

  Run duration:      5.6s
  Cache:             0/1 hit (0%)
  Critical path:     5.5s (1 task)
  Recoverable time:  <1ms
```

`npx nx run agent-generation:lint --output-style=static 2>&1 | Select-Object -Last 10`

```text
NX   Successfully ran target lint for project @ptah-extension/agent-generation


View logs and investigate cache misses at https://nx.app/runs/qPifeMvaOr

  Run duration:      6.1s
  Cache:             0/1 hit (0%)
  Critical path:     6.0s (1 task)
  Recoverable time:  <1ms
```

## Limitations

No live end-to-end wizard generation was run. Fixed-prefix acceptance through the analysis index remains unchanged by request; it can establish a prefixed glob from an indexed directory without a matching filename. Exact indexed citations also remain trusted. Disk-only glob validation now requires an actual in-root file match. No git commands were run.

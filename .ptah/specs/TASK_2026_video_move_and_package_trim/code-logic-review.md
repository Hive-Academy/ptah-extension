# Code Logic Review - video move and package trim

## Verdict: APPROVE (8.5/10)

Diff was taken against the merge-base (`dd2f166da`), not the moved `main` tip. Against the main tip, the diff also shows unrelated main-side commits in reverse (publish-electron.yml, appx assets, update-manager, build-identity), so those are not part of this change.

## Findings

1. Minor - `apps/ptah-docs/src/content/docs/plugins/marketplace.md:33` still uses `remotion` as an example keyword that "finds the right pack". The `ptah-video` pack was removed, so the example no longer matches any catalog entry. Replace it with a keyword from a remaining pack.
2. Minor - `apps/ptah-electron-e2e/docs-screenshots.config.ts:11`, `src/docs-screenshots/_harness/docs-fixtures.ts:24` and `shooter.ts:37` mention the deleted `showcase/_harness` in comments. These are comments only and nothing imports it, but they now point at a path that does not exist.
3. Minor - `tools/mcp-bench/questions/7910f34cf/*.json` and `fixtures/memory-skills/*` still list paths under `apps/ptah-video-studio` and `tools/hyperframes` as ground truth. This is acceptable because `tools/mcp-bench/corpus.config.json:3` pins the corpus to commit `7910f34cf`. Do not regenerate the questions against the trimmed tree.
4. Minor (scope note, harmless) - `eslint.config.mjs` also drops the dead `scope:api`, `scope:api-contracts` and `scope:app` boundary rules and the `libs/api/core/.../generated-prisma-client` ignore. `.gitignore` drops `.vscode-test/`, `generated-prisma-client` and the license-server block. `libs/api` no longer exists, and a grep found no remaining `scope:api*` tag in any project.json. This is unrelated cleanup bundled into the same change. Mention it in the PR body.

No blocking or serious findings.

## Checked and clean

- **Removed packages in source and configs.** I grepped imports, `require`, `import()` and `mock()` for `node-pty`, `nodejs-whisper`, `@xterm/headless`, `adm-zip`, `tree-kill`, `@angular/cdk-experimental`, `@angular/platform-browser-dynamic`, `@eslint/js`, `react`, `react-dom`, `three`, `remotion` and `@remotion/*`.
  - There are no live imports.
  - The only hits are `import React` fixture strings inside `framework-rules.spec.ts:1007-1071`, comments, and prose that mentions tree-kill.
  - `node-pty` appears only as string matching in `copilot-sdk.adapter.ts:307` and a comment in `cli-adapter.utils.ts:293`. Neither imports it.
  - `tree-kill` is not imported anywhere. The repo uses its own `killProcessTree`.
- **node-pty and nodejs-whisper in Electron packaging.**
  - `apps/ptah-electron/electron-builder.yml` has no reference to either package. `apps/ptah-electron/package.json` has none either.
  - The deps spec comment in `apps/ptah-electron/src/config/packaged-deps.spec.ts:13` only mentions `@xterm/*` historically.
  - Voice transcription runs on `@huggingface/transformers` (`package.json:90`, `apps/ptah-electron/package.json:21`, used by memory-curator), not `nodejs-whisper`.
  - The docs rewrite in `voice-messages.md` and `messaging/index.md` matches that.
  - `libs/backend/rpc-handlers/project.json` and `tools/mcp-bench/project.json` (two places) only dropped the `nodejs-whisper` externals entry. Nothing imports the package.
- **CI.** `.github/actions/setup-ci/action.yml` now runs `npm rebuild better-sqlite3` and drops `node-pty`. Nothing else needs the rebuild. The `render-showcase.yml` and `upload-recordings.yml` workflows are deleted, and no workflow references video, hyperframes or remotion.
- **tsconfig.base.json.** Only the `@ptah-extension/showcase-manifest` path alias was removed, and nothing else references it.
- **nx.json.** Only the `apps/ptah-video-studio/**/*` input glob and a comment were changed.
- **Root scripts.** The `studio` script is removed. No remaining script, husky hook or lint-staged entry mentions the removed tools.
- **Electron e2e.**
  - The real `e2e` and `e2e:nightly` targets remain.
  - `tsconfig.spec.json` now includes `src/specs`, `src/support`, `src/docs-screenshots`, `playwright.config.ts` and `docs-screenshots.config.ts`. That covers the retained suites.
  - Nothing imports the deleted showcase harness.
  - `renderer-cache-key.spec.ts` was updated consistently:
    - The title now says "two dev-build targets".
    - The `showcase` target assertion is removed.
    - `it.each` is reduced to `['e2e', 'e2e:nightly']`. The removed target is gone, so no real coverage is lost.
- **Catalog and test counts.**
  - Agent templates on disk: 14 `*.template.md`. `EXPECTED_TEMPLATE_COUNT` is 14, and the `>= 14` assertion in agent-recommendation matches.
  - The prompt catalogue went from 26 to 25 prompts after one entry was removed. Both `toHaveLength` and the test title were updated.
  - The `ptah-video` plugin entry is removed from `plugin-loader.service.ts`, and the `plugins/` dir has no `ptah-video`.
  - `subagent-tool-allowlist` drops `video-director`.
  - Fixture renames (`video-director` to `sample-agent` / `technical-content-writer`, `video-showcase` to `example-skill`) are mechanical. A whitespace-insensitive diff of `user-layer-seed-quarantine.spec.ts` shows only slug and label substitutions.
  - The `every recommended` assertion tightened to `r.recommended` because the opt-in exception no longer applies. No test was weakened.
- **Remaining `remotion` / `hyperframes` strings.** These are the intentional skills.sh catalog entry, the MCP OAuth key fixtures (`config-watcher.spec.ts:56`) and a code comment (`skill-sh-browser.component.ts:45`).

## Review family: claude in-process subagent (implementer: codex). Weaker-evidence label: none needed, different family; reason for subagent: no non-codex CLI lane had room.

## Sweep

The requested file-class sweep used `rg` over `.github/`, every `package.json`, `scripts/`, `tools/`, `*.mjs`, `*.cjs`, `*.js`, `*.ts`, `*.yml`, `*.yaml`, and `Dockerfile*`, excluding dependency and build-output directories. A second `git grep` across all tracked repository content found the historical/documentary matches and lockfile metadata shown below. The final repeat of the requested file-class sweep found no residual matches.

| file:line                                                            | Old text                                                                                 | New text                                                                       | Changed?                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `.github/workflows/ci.yml:143`                                       | `node node_modules/nx/bin/nx.js run degradation-audit:self-test`                         | `node_modules/.bin/nx run degradation-audit:self-test`                         | Yes                                                          |
| `.github/workflows/ci.yml:144`                                       | `node node_modules/nx/bin/nx.js run degradation-audit:lint`                              | `node_modules/.bin/nx run degradation-audit:lint`                              | Yes                                                          |
| `.github/workflows/ci.yml:182`                                       | `node node_modules/nx/bin/nx.js affected -t test --coverage --parallel=3 --maxWorkers=2` | `node_modules/.bin/nx affected -t test --coverage --parallel=3 --maxWorkers=2` | Yes                                                          |
| `.github/workflows/publish-cli.yml:354`                              | `node node_modules/nx/bin/nx.js run ptah-cli:restore-cli-manifest`                       | `node_modules/.bin/nx run ptah-cli:restore-cli-manifest`                       | Yes                                                          |
| `apps/ptah-cli/src/test-utils/packaged-files.spec.ts:193`            | `'node node_modules/nx/bin/nx.js run ptah-cli:restore-cli-manifest'`                     | `'node_modules/.bin/nx run ptah-cli:restore-cli-manifest'`                     | Yes; updated regression assertion                            |
| `.ptah/specs/TASK_2026_404_edeb/investigation.md:299`                | `node node_modules/nx/bin/nx.js affected -t test --coverage --parallel=3 --maxWorkers=2` | Unchanged historical investigation evidence                                    | No; `.ptah/` changes were prohibited except this deliverable |
| `.ptah/specs/TASK_2026_437_0778/b4-code-logic-review.md:483`         | `node node_modules/nx/bin/nx.js run degradation-audit:lint`                              | Unchanged historical review evidence                                           | No; `.ptah/` changes were prohibited except this deliverable |
| `.ptah/specs/TASK_2026_437_0778/ci-sqlite-abort-investigation.md:40` | `node node_modules/nx/bin/nx.js affected -t`                                             | Unchanged historical investigation evidence                                    | No; `.ptah/` changes were prohibited except this deliverable |
| `.ptah/specs/TASK_2026_486_3b7e/context.md:17`                       | `nx/bin/run-executor.js`                                                                 | Unchanged process-description text; not the removed CLI entry point            | No                                                           |
| `package-lock.json:31270`                                            | `"nx": "dist/bin/nx.js"`                                                                 | Unchanged Nx package metadata for the current entry point; not an invocation   | No; lockfile changes were prohibited                         |

## Choice

The corrected choice is `node_modules/.bin/nx ...`. This is npm's install-generated executable shim, which follows Nx's declared `bin` field and therefore does not depend on package-internal paths such as removed `nx/bin/nx.js` or current `nx/dist/bin/nx.js`. It also avoids `npx`, which can install a package on demand and run lifecycle scripts and therefore triggers SonarCloud rules `githubactions:S6505` and `S8543`. Each affected Ubuntu job runs `npm ci` first, so the local shim exists before use.

## Correction

The first attempt incorrectly replaced the broken internal path with `npx nx` and deleted comments documenting a deliberate SonarCloud security remediation. That preserved layout independence but reintroduced `githubactions:S6505` and `S8543` on newly edited lines, potentially exchanging the Nx 23 failure for a SonarCloud gate failure. The corrected commands use npm's local shim. Comments at each site now preserve both constraints: do not use `npx` because it can download packages and run lifecycle scripts, and do not reach into Nx package internals because Nx 23 removed `nx/bin/nx.js`.

## Windows

None of the four affected workflow commands runs on a Windows runner: all three `ci.yml` commands are in `main` (`ubuntu-latest`), and the affected `publish-cli.yml` command is in `publish` (`ubuntu-latest`). On Linux, `node_modules/.bin/nx` is npm's executable shim. As an additional check, the exact `./node_modules/.bin/nx --version` form also resolved successfully from PowerShell in this Windows workspace.

## Verification

Nx resolution probe from repository root:

```text
> ./node_modules/.bin/nx --version
Nx Version:
- Local: v23.2.1
- Global: Not found
```

YAML parsing used the installed `yaml` npm package through Node (`YAML.parse`) on both changed workflow files:

```text
> node -e "const fs=require('node:fs'); const YAML=require('yaml'); for (const f of ['.github/workflows/ci.yml','.github/workflows/publish-cli.yml']) { YAML.parse(fs.readFileSync(f,'utf8')); console.log('YAML OK: '+f); }"
YAML OK: .github/workflows/ci.yml
YAML OK: .github/workflows/publish-cli.yml
```

The focused regression spec that pins the publish workflow command also passed when run directly, without the Nx target's build dependencies:

```text
> npx jest --config apps/ptah-cli/jest.config.cjs --runTestsByPath apps/ptah-cli/src/test-utils/packaged-files.spec.ts --runInBand
Test Suites: 1 passed, 1 total
Tests:       19 passed, 19 total
Snapshots:   0 total
Time:        3.404 s
Ran all test suites within paths "apps/ptah-cli/src/test-utils/packaged-files.spec.ts".
```

## Residual risk

The changed workflows were not executed on GitHub-hosted runners, and the full affected-test sweep was intentionally not run. Local Nx resolution, Node-based YAML parsing, the focused 19-test regression suite, runner inspection, and the post-change repository sweep are the available evidence.

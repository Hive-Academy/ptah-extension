## DevOps change — `TASK_2026_610`, batch AF4

**Scope**: CI enforcement of the eager-closure webview bundle gate.

**Files**:

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\.github\workflows\ci.yml` — runs the existing eager-closure gate after the affected build when webview stats exist.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\.ptah\specs\TASK_2026_610_6a10\batch-AF4-report.md` — records this change and verification evidence.

**Surface observed**: The `main` job in `.github/workflows/ci.yml` runs `npx nx affected -t build`; `apps/ptah-extension-webview/project.json` defines the webview build's production `statsJson` output. The existing `gate:eager-closure` package script invokes `scripts/eager-closure-gate.js` with `dist/apps/ptah-extension-webview/stats.json`. The adjacent webview automation surface is `.github/workflows/webview-e2e.yml`.

**Job and step changed**: Added to CI job `main`, immediately after `npx nx affected -t build`.

```diff
       - run: npx nx affected -t build

+      - name: Enforce eager-closure bundle gate
+        if: hashFiles('dist/apps/ptah-extension-webview/stats.json') != ''
+        run: npm run gate:eager-closure
```

**Triggers affected**: None. The existing `pull_request` trigger and its `main` branch filter remain unchanged.

**Guard**: Yes. `nx affected -t build` can legitimately skip `ptah-extension-webview`; the `hashFiles()` condition prevents an absent stats artifact from failing unrelated pull requests. When the webview is built, its stats artifact is present and the gate runs in the same job directly after the build.

**Verification**:

- `node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/ci.yml','utf8'))"` — PASS.
- `npm run gate:eager-closure` — exit 0; output: `[eager-closure-gate] eager inputs: 720; initial chunk bytes: 2848414`.
- Scoped editor diagnostics for `.github/workflows/ci.yml` — clean; YAML diagnostics unavailable because the syntax service does not check this file type.

**Rollback**: Remove the `Enforce eager-closure bundle gate` step from `.github/workflows/ci.yml`; no generated artifacts, secrets, or release configuration require cleanup.

**Secrets or variables required**: None.

**Out-of-scope observations**: The CI build is affected-only, so the guard is necessary to avoid running this webview-specific gate when its output is not produced. No explicit webview production-build step was added.

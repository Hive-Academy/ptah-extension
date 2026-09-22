# Batch G — Release gate report

**Task**: `TASK_2026_523_c3df`, batch **G** (devops-engineer)
**Gate**: the packaged VSIX must contain **no non-JavaScript file whose PATH or CONTENT
carries a trademarked vendor token** (`claude`, `anthropic`, `copilot`, `codex`,
`openai`, `gpt`, `cursor`, `gemini`, case-insensitive).
**Branch under test**: `feat/task-2026-523-providers-auth` @ `da4ebaa82`
**Date**: 2026-09-22

Verification only — no fix was made, no tracked file was edited, no marketplace
command was run.

---

## Commands

Every command below is quoted exactly as executed, with its real output. `[…]`
marks a contiguous block of unchanged Nx task lines omitted for length; nothing
else is elided.

### 0. Environment note — why the repo's literal `npx nx …` is spelled differently

The repo/CI command is `npx nx run ptah-extension-vscode:package`
(`.github/workflows/publish-extension.yml:156`). In this sandbox's bash, `npx`
itself is broken:

```
$ npx @vscode/vsce --version
/bin/bash: C:/Program Files/nodejs/npx: No such file or directory
(nothing else)
```
```
$ npx nx run ptah-extension-vscode:package
/bin/bash: C:/Program Files/nodejs/npx: No such file or directory
```

So the identical entry point was invoked through the package's own `bin` field
(`node_modules/nx/package.json` → `{"nx":"./dist/bin/nx.js"}`), with the
task-mandated lane-scoped Nx environment:

```
$ NX_DAEMON=false NX_CACHE_DIRECTORY=D:/projects/ptah-extension/.nx/verify-cache-g node node_modules/nx/dist/bin/nx.js run ptah-extension-vscode:package
```

Inside the target, the repository's own packaging command ran unmodified:
`cd dist/apps/ptah-extension-vscode && npx @vscode/vsce package --allow-missing-repository --allow-star-activation`
(`apps/ptah-extension-vscode/project.json:122`), i.e. `vsce package` only — a
local operation. No `vsce publish` / `login` / `verify-pat` was executed.

### 1. Packaging attempt 1 — live working tree (FAILED: concurrent lane broke the build)

Working directory `D:\projects\ptah-extension`:

```
$ NX_DAEMON=false NX_CACHE_DIRECTORY=D:/projects/ptah-extension/.nx/verify-cache-g node node_modules/nx/dist/bin/nx.js run ptah-extension-vscode:package

 NX   Running target package for project ptah-extension-vscode and 32 tasks it depends on:


√  nx run @ptah-extension/memory-contracts:build
√  nx run @ptah-extension/shared:build
[…] (27 further dependency tasks succeeded)
√  nx run @ptah-extension/platform-vscode:build

> nx run ptah-extension-vscode:build-esbuild:production

> nx run ptah-extension-webview:build:production

❯ Building...

WARNING: "@nx/angular/tailwind" is deprecated and will be removed in Nx 24.
Migrate to Tailwind CSS v4 which no longer needs glob patterns for content detection.
See: https://nx.dev/docs/technologies/angular/guides/using-tailwind-css-with-angular-projects

✔ Building...
Application bundle generation failed. [86.637 seconds] - 2026-09-22T10:13:04.848Z

X [ERROR] TS2339: Property 'name' does not exist on type '{ provider: string; displayName: string; isConfigured: boolean; defaultModel: string; capabilities: LlmProviderCapability[]; }'. [plugin angular-compiler]

    libs/frontend/core/src/lib/services/providers-settings-state.service.ts:298:66:
      298 │ ... status.providers.find((provider) => provider.name === entry.id);
          ╵                                                  ~~~~

X [ERROR] TS2339: Property 'hasApiKey' does not exist on type '{ provider: string; displayName: string; isConfigured: boolean; defaultModel: string; capabilities: LlmProviderCapability[]; }'. [plugin angular-compiler]

    libs/frontend/core/src/lib/services/providers-settings-state.service.ts:302:56:
      302 │ ...id: entry.id, name: entry.name, hasKey: host?.hasApiKey === true,
          ╵                                                  ~~~~~~~~~

X [ERROR] TS2339: Property 'hasApiKey' does not exist on type '{ provider: string; displayName: string; isConfigured: boolean; defaultModel: string; capabilities: LlmProviderCapability[]; }'. [plugin angular-compiler]

    libs/frontend/core/src/lib/services/providers-settings-state.service.ts:303:28:
      303 │           configured: host?.hasApiKey === true || host?.baseUrlOv...

X [ERROR] TS2339: Property 'baseUrlOverridden' does not exist on type '{ provider: string; displayName: string; isConfigured: boolean; defaultModel: string; capabilities: LlmProviderCapability[]; }'. [plugin angular-compiler]

    libs/frontend/core/src/lib/services/providers-settings-state.service.ts:303:56:
      303 │ ...iKey === true || host?.baseUrlOverridden === true || customIds...

X [ERROR] TS2345: Argument of type '() => Promise<{ signInState: string; cliInstalled: boolean | null; message: string; providerId: string | null; accountLabel: string | null; }>' is not assignable to parameter of type '() => Promise<ProvidersExternalAuth>'.
  Type 'Promise<{ signInState: string; cliInstalled: boolean | null; message: string; providerId: string | null; accountLabel: string | null; }>' is not assignable to type 'Promise<ProvidersExternalAuth>'.
    Types of property 'signInState' are incompatible.
        Type 'string' is not assignable to type '"failed" | "idle" | "in-flight" | "signed-in"'. [plugin angular-compiler]

    libs/frontend/core/src/lib/services/providers-settings-state.service.ts:331:44:
      331 │     await this.read(this.externalAuthStore, async () => {


 NX   Running target package for project ptah-extension-vscode and 32 tasks it depends on failed

Tasks not run because their dependencies failed or --nx-bail=true:

- ptah-extension-vscode:package
- ptah-extension-vscode:pre-package
- ptah-extension-vscode:build
- ptah-extension-vscode:post-build-copy

Failed tasks:

- ptah-extension-webview:build:production

[…]

  Run duration:      4m 31s
  Cache:             0/28 hit (0%)
```
```
exit code 130
```

The offending file is **another lane's uncommitted work**, not mine:

```
$ git status --porcelain=v1 -- libs/frontend/core/src/lib/services/providers-settings-state.service.ts apps/ptah-extension-vscode
?? libs/frontend/core/src/lib/services/providers-settings-state.service.ts
```

### 2. Packaging attempt 2 — live working tree, retried after Nx cache warm (FAILED, same 5 errors)

```
$ NX_DAEMON=false NX_CACHE_DIRECTORY=D:/projects/ptah-extension/.nx/verify-cache-g node node_modules/nx/dist/bin/nx.js run ptah-extension-vscode:package
```
Same five `TS2339` / `TS2345` errors in
`libs/frontend/core/src/lib/services/providers-settings-state.service.ts`
(lines 298, 302, 303 ×2, 331), `Failed tasks: ptah-extension-webview:build:production`,
`Run duration: 41.6s`, `Cache: 28/28 hit (100%)`, exit code 130.

Conclusion: the dirty working tree cannot produce an archive while lane D-i's
untracked file is in this state. The gate therefore ran against a **clean
detached checkout of the same commit** (which already contains batch C, the
change under test), built with the repository's own targets.

### 3. Clean detached worktree at the same commit

```
$ git worktree add --detach "C:/Users/abdal/AppData/Local/Temp/opencode/ptah-verify-g" HEAD
Preparing worktree (detached HEAD da4ebaa82)
[… 8068 files checked out …]
HEAD is now at da4ebaa82 feat(auth-providers): bring batch A2 draft verification onto the branch
```
```
$ powershell -NoProfile -Command "New-Item -ItemType Junction -Path 'C:\Users\abdal\AppData\Local\Temp\opencode\ptah-verify-g\node_modules' -Target 'D:\projects\ptah-extension\node_modules' | Select-Object -ExpandProperty FullName"
C:\Users\abdal\AppData\Local\Temp\opencode\ptah-verify-g\node_modules
```
```
$ git ls-files apps/ptah-extension-vscode/.vscodeignore README.md apps/ptah-extension-vscode/package.json
README.md
apps/ptah-extension-vscode/.vscodeignore
apps/ptah-extension-vscode/package.json
```
(All three inputs the `pre-package` target copies are tracked, so the checkout is
self-contained. The repo declares no npm `workspaces`, and `node_modules` has no
`@ptah-extension/*` symlinks — libs resolve via `tsconfig` paths — so the single
junction is sufficient and resolves to the worktree's own sources.)

### 4. Packaging attempt 3 — clean worktree (SUCCEEDED)

Working directory `C:\Users\abdal\AppData\Local\Temp\opencode\ptah-verify-g`:

```
$ NX_DAEMON=false NX_CACHE_DIRECTORY=D:/projects/ptah-extension/.nx/verify-cache-g node node_modules/nx/dist/bin/nx.js run ptah-extension-vscode:package

 NX   Running target package for project ptah-extension-vscode and 32 tasks it depends on:


√  nx run @ptah-extension/memory-contracts:build
√  nx run @ptah-extension/shared:build
[…] (26 further dependency tasks succeeded)
√  nx run @ptah-extension/platform-vscode:build

> nx run ptah-extension-vscode:build-esbuild:production

√  nx run ptah-extension-webview:build:production

> nx run ptah-extension-vscode:post-build-copy

> node scripts/copy-wasm.js dist/apps/ptah-extension-vscode

  Copied web-tree-sitter.wasm (204.7 KB)
  Copied tree-sitter-javascript.wasm (402.1 KB)
  Copied tree-sitter-typescript.wasm (1380.7 KB)
  Copied tree-sitter-python.wasm (447.2 KB)
  Copied tree-sitter-go.wasm (212.1 KB)
  Copied tree-sitter-c-sharp.wasm (4983.7 KB)
WASM assets copied to C:\Users\abdal\AppData\Local\Temp\opencode\ptah-verify-g\dist\apps\ptah-extension-vscode\wasm
> node scripts/copy-webview.js

Webview copied (Monaco excluded), metadata files copied.

> nx run ptah-extension-vscode:pre-package

> node -e "const fs=require('fs'); fs.copyFileSync('apps/ptah-extension-vscode/.vscodeignore', 'dist/apps/ptah-extension-vscode/.vscodeignore')"

> node -e "const fs=require('fs'); fs.copyFileSync('README.md', 'dist/apps/ptah-extension-vscode/README.md')"


> nx run ptah-extension-vscode:package

> cd dist/apps/ptah-extension-vscode && npx @vscode/vsce package --allow-missing-repository --allow-star-activation

npm warn exec The following package was not found and will be installed: @vscode/vsce@4.0.0
 WARNING  LICENSE.md not found
 INFO  Files included in the VSIX:
ptah-coding-orchestra-0.2.43.vsix
├─ [Content_Types].xml 
├─ extension.vsixmanifest 
└─ extension/
   ├─ main.mjs [19.75 MB]
   ├─ package.json [9.47 KB]
   ├─ readme.md [11.72 KB]
   ├─ assets/
   │  ├─ .gitkeep 
   │  └─ images/ (3 files) [564.92 KB]
   ├─ wasm/
   │  ├─ tree-sitter-c-sharp.wasm [4.87 MB]
   │  ├─ tree-sitter-go.wasm [212.09 KB]
   │  ├─ tree-sitter-javascript.wasm [402.12 KB]
   │  ├─ tree-sitter-python.wasm [447.15 KB]
   │  ├─ tree-sitter-typescript.wasm [1.35 MB]
   │  └─ web-tree-sitter.wasm [204.7 KB]
   └─ webview/
      └─ browser/ (26 files) [5.6 MB]

=> Run vsce ls --tree to see all included files.

 DONE  Packaged: C:\Users\abdal\AppData\Local\Temp\opencode\ptah-verify-g\dist\apps\ptah-extension-vscode\ptah-coding-orchestra-0.2.43.vsix (41 files, 10.75 MB)


 NX   Successfully ran target package for project ptah-extension-vscode and 32 tasks it depends on

Output of 28 successful tasks were not shown. Run with --verbose or --output-style=static to see more.

  Run duration:      6m 40s
  Cache:             0/33 hit (0%)
```
```
exit code 0
```

### 5. `vsce ls` — flat list

`npx @vscode/vsce ls` was attempted first and failed on the same broken `npx`
(`/bin/bash: C:/Program Files/nodejs/npx: No such file or directory`), so the
identical CLI was run through its `bin` file directly. Working directory
`…\ptah-verify-g\dist\apps\ptah-extension-vscode`:

```
$ node "C:\Users\abdal\AppData\Local\Temp\opencode\ptah-verify-g\node_modules\@vscode\vsce\vsce" ls
main.mjs
package.json
README.md
assets/.gitkeep
wasm/tree-sitter-c-sharp.wasm
wasm/tree-sitter-go.wasm
wasm/tree-sitter-javascript.wasm
wasm/tree-sitter-python.wasm
wasm/tree-sitter-typescript.wasm
wasm/web-tree-sitter.wasm
assets/images/ptah-icon-sidebar.svg
assets/images/ptah-icon-toolbar.svg
assets/images/ptah-icon.png
webview/browser/chunk-B0O9XIKV.js
webview/browser/chunk-B1ow0ZT8.js
webview/browser/chunk-B7DBZGXJ.js
webview/browser/chunk-BDQwmt7m.js
webview/browser/chunk-BJRkqR33.js
webview/browser/chunk-B_EpXXlk.js
webview/browser/chunk-CMQeW0di.js
webview/browser/chunk-Cqy1wTBH.js
webview/browser/chunk-CxK1qtku.js
webview/browser/chunk-D2BKLVBW.js
webview/browser/chunk-D9_WsH40.js
webview/browser/chunk-DnRTbWB9.js
webview/browser/chunk-DsJJBUv-.js
webview/browser/chunk-DUNB2ibz.js
webview/browser/chunk-GEopQcIe.js
webview/browser/chunk-Qf9S2OxZ.js
webview/browser/chunk-ZlUdKnT7.js
webview/browser/index.html
webview/browser/main.js
webview/browser/polyfills.js
webview/browser/scripts.js
webview/browser/styles.css
webview/browser/theme-extra.css
webview/browser/images/ptah-icon.png
webview/browser/images/temple-bg.png
webview/browser/images/user-icon.png
```

```
$ node "C:\Users\abdal\AppData\Local\Temp\opencode\ptah-verify-g\node_modules\@vscode\vsce\vsce" ls --tree
ptah-coding-orchestra-0.2.43.vsix
├─ README.md [11.72 KB]
├─ main.mjs [19.75 MB]
├─ package.json [9.47 KB]
├─ assets/
│  ├─ .gitkeep 
│  └─ images/
│     ├─ ptah-icon-sidebar.svg [0.92 KB]
│     ├─ ptah-icon-toolbar.svg [2.3 KB]
│     └─ ptah-icon.png [561.7 KB]
├─ wasm/
│  ├─ tree-sitter-c-sharp.wasm [4.87 MB]
│  ├─ tree-sitter-go.wasm [212.09 KB]
│  ├─ tree-sitter-javascript.wasm [402.12 KB]
│  ├─ tree-sitter-python.wasm [447.15 KB]
│  ├─ tree-sitter-typescript.wasm [1.35 MB]
│  └─ web-tree-sitter.wasm [204.7 KB]
└─ webview/
   └─ browser/
      ├─ chunk-B0O9XIKV.js [18.02 KB]
      ├─ chunk-B1ow0ZT8.js [125.42 KB]
      ├─ chunk-B7DBZGXJ.js [7.65 KB]
      ├─ chunk-BDQwmt7m.js [92.41 KB]
      ├─ chunk-BJRkqR33.js [16.43 KB]
      ├─ chunk-B_EpXXlk.js [98 KB]
      ├─ chunk-CMQeW0di.js [517.74 KB]
      ├─ chunk-Cqy1wTBH.js [291.69 KB]
      ├─ chunk-CxK1qtku.js [360.33 KB]
      ├─ chunk-D2BKLVBW.js [0.09 KB]
      ├─ chunk-D9_WsH40.js [163.83 KB]
      ├─ chunk-DUNB2ibz.js [61.35 KB]
      ├─ chunk-DnRTbWB9.js [0.93 KB]
      ├─ chunk-DsJJBUv-.js [0.74 KB]
      ├─ chunk-GEopQcIe.js [4.92 KB]
      ├─ chunk-Qf9S2OxZ.js [0.68 KB]
      ├─ chunk-ZlUdKnT7.js [19.62 KB]
      ├─ index.html [5.75 KB]
      ├─ main.js [1.77 MB]
      ├─ polyfills.js [35.04 KB]
      ├─ scripts.js [47.07 KB]
      ├─ styles.css [254.33 KB]
      ├─ theme-extra.css [51.73 KB]
      └─ images/
         ├─ ptah-icon.png [561.7 KB]
         ├─ temple-bg.png [780.05 KB]
         └─ user-icon.png [404.52 KB]
```

### 6. Primary scan — every entry of the actual `.vsix` (path **and** contents)

Scanner: `C:\Users\abdal\AppData\Local\Temp\opencode\scan-gate-g.mjs` (reads the
VSIX zip with `yauzl`, classifies `.js/.mjs/.cjs/.map/.wasm` as the JavaScript
family, tests the path and every line of every non-JS entry case-insensitively
against the eight tokens).

```
$ node "C:\Users\abdal\AppData\Local\Temp\opencode\scan-gate-g.mjs" "C:\Users\abdal\AppData\Local\Temp\opencode\ptah-verify-g\dist\apps\ptah-extension-vscode\ptah-coding-orchestra-0.2.43.vsix"
VSIX: C:\Users\abdal\AppData\Local\Temp\opencode\ptah-verify-g\dist\apps\ptah-extension-vscode\ptah-coding-orchestra-0.2.43.vsix
Total entries (files): 41
JavaScript family (.js/.mjs/.cjs/.map/.wasm): 27
Non-JavaScript: 14

--- NON-JS FILES SCANNED ---
extension.vsixmanifest
[Content_Types].xml
extension/package.json
extension/readme.md
extension/assets/.gitkeep
extension/assets/images/ptah-icon-sidebar.svg
extension/assets/images/ptah-icon-toolbar.svg
extension/assets/images/ptah-icon.png
extension/webview/browser/index.html
extension/webview/browser/styles.css
extension/webview/browser/theme-extra.css
extension/webview/browser/images/ptah-icon.png
extension/webview/browser/images/temple-bg.png
extension/webview/browser/images/user-icon.png

--- FINDINGS: 3 hit(s) ---
PATH: extension/package.json
  where: content | token(s): claude
  line 202: "claudeCli",
PATH: extension/package.json
  where: content | token(s): claude,anthropic
  line 206: "description": "Authentication method for Ptah. 'apiKey' uses a direct Anthropic API key, 'claudeCli' uses Claude CLI credentials from 'claude login', 'openrouter' routes through a configured third-party provider."
PATH: extension/webview/browser/styles.css
  where: content | token(s): cursor
  line 1: @font-face{font-family:Cinzel;font-style:normal;font-weight:400;font-display:swap;src:url(https://fonts.gstatic.com/s/cinzel/v26/8vIJ7ww63mVu7gt7-GT7LEc.woff2) format("woff2");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7
```

### 7. Independent cross-check (PowerShell, over the packaged `dist` tree)

`C:\Users\abdal\AppData\Local\Temp\opencode\scan-gate-g.ps1` — second method,
second implementation of the same rule:

```
$ powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\abdal\AppData\Local\Temp\opencode\scan-gate-g.ps1"
non-JS files inspected: 14
  .vscodeignore
  LICENSE.md
  package.json
  README.md
  assets\.gitkeep
  assets\images\ptah-icon-sidebar.svg
  assets\images\ptah-icon-toolbar.svg
  assets\images\ptah-icon.png
  webview\browser\index.html
  webview\browser\styles.css
  webview\browser\theme-extra.css
  webview\browser\images\ptah-icon.png
  webview\browser\images\temple-bg.png
  webview\browser\images\user-icon.png
--- matches ---
.vscodeignore :: line 20 :: ...CLAUDE.md...
package.json :: line 202 :: ...            "claudeCli",...
package.json :: line 206 :: ...n": "Authentication method for Ptah. 'apiKey' uses a direct Anthropic API key, 'claudeCli' uses Claude CLI credentials from 'claude login', 'openrouter' routes ...
webview\browser\styles.css :: line 1 :: ...{transform:rotate(-45deg)}.grid-stack-item>.ui-resizable-nw{cursor:nw-resize;width:20px;height:20px;top:var(--gs-item-margin-top);left:var(--gs-item-margin-left...
files with hits: 3
```

`.vscodeignore` and `LICENSE.md` exist in `dist` but are **excluded from the
archive** (`.vscodeignore` is never packaged; `**/LICENSE.md` is an explicit
`.vscodeignore` rule, comment `# License file — triggers marketplace scanner.`).
The `.vscodeignore` hit (`CLAUDE.md`, a rule *excluding* a file) and `LICENSE.md`
are therefore not part of the VSIX and are not findings — confirmed by the
zip-level scan in §6, which saw 14 non-JS entries and no `.vscodeignore` /
`LICENSE.md`.

### 8. Binary files re-scanned as latin1 (defends against UTF-8 decode loss)

```
$ node -e "<reads every .png/.gitkeep under dist as latin1, tests the eight tokens>"
clean dist/apps/ptah-extension-vscode/assets/.gitkeep
clean dist/apps/ptah-extension-vscode/assets/images/ptah-icon.png
clean dist/apps/ptah-extension-vscode/webview/browser/images/ptah-icon.png
clean dist/apps/ptah-extension-vscode/webview/browser/images/temple-bg.png
clean dist/apps/ptah-extension-vscode/webview/browser/images/user-icon.png
binary/other files checked: 5
```

### 9. Context for the `styles.css` hit (is it the AI product "Cursor"?)

```
$ node -e "<all token occurrences in styles.css with ±70 chars of context>"
cursor @21243 : ...sizable-se{transform:rotate(-45deg)}.grid-stack-item>.ui-resizable-nw{cursor:nw-resize;width:20px;height:20px;top:var(--gs-item-margin-top);...
cursor @21378 : ...top);left:var(--gs-item-margin-left)}.grid-stack-item>.ui-resizable-n{cursor:n-resize;height:10px;top:var(--gs-item-margin-top);left:25px;ri...
cursor @21491 : ...em-margin-top);left:25px;right:25px}.grid-stack-item>.ui-resizable-ne{cursor:ne-resize;width:10px;height:10px;top:var(--gs-item-margin-top);left...
cursor @21628 : ...p);right:25px}.grid-stack-item>.ui-resizable-e{cursor:e-resize;width:10px;top:15px;height:15px;left:-5px;...
cursor @21744 : ...x:25px}.grid-stack-item>.ui-resizable-se{cursor:se-resize;width:20px;height:20px;top:-5px;left:-5px;...
cursor total occurrences: 65
```

All 65 are the CSS `cursor:` property (gridstack resize handles), e.g.
`cursor:nw-resize`, `cursor:grab`. The identical literal ships in the dependency
itself:

```
$ node -e "<search node_modules/gridstack/dist/*.css for 'cursor:nw-resize'>"
node_modules/gridstack/dist/gridstack.min.css contains cursor:nw-resize at 1921
```

→ keyword false positive, not the vendor product.

### 10. Provenance — did this task's changes introduce any hit?

Batch C (the change this gate exists to verify) added **no asset files**:

```
$ git show --stat --oneline b156e62c2
b156e62c2 feat(ui): add provider marks and extend the shared model picker
 libs/frontend/ui/src/lib/native/index.ts           |   1 +
 .../ui/src/lib/native/provider-mark/index.ts       |   6 +
 .../provider-mark/provider-mark.component.spec.ts  |  92 +++++++
 .../provider-mark/provider-mark.component.ts       | 112 ++++++++++++++
 .../provider-mark/provider-marks.data.spec.ts      |  59 +++++
 .../src/lib/native/provider-mark/provider-marks.data.ts | 108 ++++++++++++++++
 .../src/lib/native/provider-model-picker/index.ts  |   5 +-
 .../provider-model-picker.component.spec.ts        | 294 +++++++++++++++++++++
 .../provider-model-picker.component.ts             | 287 +++++++++++++++++---
 9 files changed, 924 insertions(+), 40 deletions(-)
```

The `package.json` hits predate the task by months:

```
$ git log -1 --format="%h %ad %an %s" --date=short -S "Anthropic API key" -- apps/ptah-extension-vscode/package.json
2b537f44c 2026-05-15 Abdallah khalil chore(release): extension v0.2.32 (#290)

$ git log -1 --format="%h %ad %an %s" --date=short -S "claudeCli" -- apps/ptah-extension-vscode/package.json
2b537f44c 2026-05-15 Abdallah khalil chore(release): extension v0.2.32 (#290)
```

(The file's most recent change of any kind is `0e4ab524b 2026-09-11`, eleven days
before this task's first commit; the task branch's commits are dated 2026-09-22.)

---

## Archive summary

| Measure | Count |
| --- | --- |
| Total files in the VSIX (`vsce package` → `DONE Packaged: … (41 files, 10.75 MB)`) | **41** |
| JavaScript family (`.js`, `.mjs`, `.cjs`, `.map`, `.wasm`) | **27** |
| Non-JavaScript (scanned) | **14** |

27 + 14 = 41, matching `vsce package`'s own count.
`vsce ls` prints 39 paths because the two archive-level entries
(`[Content_Types].xml`, `extension.vsixmanifest`) live outside `extension/`;
both were scanned from the zip.

JavaScript family (27): `extension/main.mjs`, 17 `webview/browser/chunk-*.js`,
`webview/browser/{main,polyfills,scripts}.js`, 6 `wasm/*.wasm`.

---

## Non-JS files scanned

All 14 entries of the VSIX, each tested on **path** and on **content**:

1. `extension.vsixmanifest`
2. `[Content_Types].xml`
3. `extension/package.json`
4. `extension/readme.md`
5. `extension/assets/.gitkeep`
6. `extension/assets/images/ptah-icon-sidebar.svg`
7. `extension/assets/images/ptah-icon-toolbar.svg`
8. `extension/assets/images/ptah-icon.png`
9. `extension/webview/browser/index.html`
10. `extension/webview/browser/styles.css`
11. `extension/webview/browser/theme-extra.css`
12. `extension/webview/browser/images/ptah-icon.png`
13. `extension/webview/browser/images/temple-bg.png`
14. `extension/webview/browser/images/user-icon.png`

---

## Findings

**Path hits: none.** No filename in the archive matches any token
(case-insensitive). The exact failure mode this gate was written for — a
vendor-named asset such as `assets/icons/claude.svg` — does not exist: the
archive holds only two `.svg` files, both Ptah-branded
(`assets/images/ptah-icon-sidebar.svg`, `assets/images/ptah-icon-toolbar.svg`),
and `assets/images/` contains nothing vendor-named.

**Content hits: 3, in 2 files.**

| # | File (archive path) | Where | Token | Matching line | Introduced by this task? |
| --- | --- | --- | --- | --- | --- |
| 1 | `extension/package.json` | content | `claude` | line 202: `"claudeCli",` (the `ptah.authMethod` enum value) | **No — pre-existing.** Introduced by `2b537f44c` (2026-05-15, `chore(release): extension v0.2.32 (#290)`); file untouched by this task (`git diff --name-only -- apps/ptah-extension-vscode` → empty) and not in batch C's commit `b156e62c2` (9 TypeScript files only). |
| 2 | `extension/package.json` | content | `claude`, `anthropic` | line 206: `"description": "Authentication method for Ptah. 'apiKey' uses a direct Anthropic API key, 'claudeCli' uses Claude CLI credentials from 'claude login', 'openrouter' routes through a configured third-party provider."` | **No — pre-existing**, same commit `2b537f44c` (2026-05-15), shipped in every release since v0.2.32. |
| 3 | `extension/webview/browser/styles.css` | content | `cursor` | line 1 (minified): `.grid-stack-item>.ui-resizable-nw{cursor:nw-resize;…}` — 65 occurrences, all the CSS `cursor:` property from gridstack (`node_modules/gridstack/dist/gridstack.min.css` contains the identical literal at offset 1921) | **No — pre-existing**, third-party dependency CSS bundled long before this task. **False positive**: a CSS keyword, not the AI product "Cursor". |

Binary entries (4 PNGs + `.gitkeep`) are clean under a latin1 re-scan (§8).
`extension/readme.md`, `index.html`, `theme-extra.css`, both Ptah SVGs,
`extension.vsixmanifest` and `[Content_Types].xml` are clean.

Provenance of what *did* change: batch C (`b156e62c2`) added 9 TypeScript files
under `libs/frontend/ui/src/lib/native/provider-mark/` and **zero asset files** —
the provider marks entering the archive are inlined TypeScript path constants
bundled into `main.mjs` / webview `.js` chunks, so no `.svg` and no vendor-named
path reached the VSIX. The batch-C claim this gate was written to verify **held**.

---

## Verdict

**FAIL** — the literal gate condition (zero token hits in non-JavaScript files)
is not met: 3 content hits across 2 files, 0 path hits; every hit is
pre-existing (manifest text from 2026-05-15 and third-party gridstack CSS, one a
keyword false positive), none was introduced by this task, and the specific
asset-path risk the gate targets is absent.

---

## Restoration

**No tracked file was modified by this task, so there is nothing to restore —
including no extension id or publisher swap.** `vsce package` performs no
marketplace id validation, so no throwaway id was needed; the packaged artifact
keeps the real id (`ptah-coding-orchestra` / publisher `ptah-extensions`,
evident from the produced filename `ptah-coding-orchestra-0.2.43.vsix`).

Proof (empty output = no diff):

```
$ git diff -- apps/ptah-extension-vscode/package.json apps/ptah-extension-vscode/.vscodeignore
(no output)

$ git diff --name-only -- apps/ptah-extension-vscode libs/frontend/ui/src/lib/native/provider-mark
(no output)
```

The only dirty paths in `D:\projects\ptah-extension` are other lanes' work,
identical to the snapshot taken **before** this batch started:

```
$ git diff --stat
 libs/frontend/core/src/index.ts                       |  1 +
 .../components/skill-synthesis-tab.component.spec.ts  | 19 ++++++++++++++++---
 .../lib/components/skill-synthesis-tab.component.ts   | 11 ++++-------
 .../src/lib/services/skill-synthesis-rpc.service.ts   |  3 ++-
 libs/shared/src/lib/types/rpc.types.ts                | 14 +++++++++++++-
 5 files changed, 36 insertions(+), 12 deletions(-)
```
```
$ git status --porcelain=v1
 M libs/frontend/core/src/index.ts
 M libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.spec.ts
 M libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts
 M libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-rpc.service.ts
 M libs/shared/src/lib/types/rpc.types.ts
?? .ptah/specs/TASK_2026_523_c3df/batch-d1-…-report.md        (6–7 files, other lanes)
?? libs/frontend/chat/src/lib/settings/providers/
?? libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts
?? libs/frontend/core/src/lib/services/providers-settings-state.service.ts
```
(`libs/frontend/chat`, `libs/frontend/core`, `libs/shared` — the three
no-touch lanes — show only their own edits; I added none. No file under
`apps/ptah-extension-vscode` or `libs/frontend/ui/.../provider-mark` is dirty.)

State this batch created, all outside tracked source, with removal commands:

| Artifact | Location | Remove with |
| --- | --- | --- |
| Detached worktree (built + VSIX + evidence) | `C:\Users\abdal\AppData\Local\Temp\opencode\ptah-verify-g` | `git worktree remove --force "C:/Users/abdal/AppData/Local/Temp/opencode/ptah-verify-g"` |
| `node_modules` junction inside it | `<worktree>\node_modules` | removed with the worktree (`--force`); if it survives: `powershell -Command "Remove-Item 'C:\Users\abdal\AppData\Local\Temp\opencode\ptah-verify-g\node_modules'"` |
| Scan scripts | `C:\Users\abdal\AppData\Local\Temp\opencode\scan-gate-g.mjs`, `…\scan-gate-g.ps1` | delete the two temp files |
| Lane Nx cache | `D:\projects\ptah-extension\.nx\verify-cache-g` | `powershell -Command "Remove-Item -Recurse 'D:\projects\ptah-extension\.nx\verify-cache-g'"` |

`git worktree list` (unchanged elsewhere; worktrees are an established pattern in
this repo — 14 others already live under `.claude-worktrees/`):

```
$ git worktree list
D:/projects/ptah-extension                                                                                    da4ebaa82 [feat/task-2026-523-providers-auth]
C:/Users/abdal/AppData/Local/Temp/opencode/ptah-verify-g                                                      da4ebaa82 (detached HEAD)
D:/projects/ptah-extension/.claude-worktrees/… (14 pre-existing worktrees)
```

---

## Not done

1. **The gate did not run against the live dirty working tree.** Two attempts at
   the repo's own `package` target failed on `ptah-extension-webview:build:production`
   with 5 TypeScript errors in lane D-i's untracked
   `libs/frontend/core/src/lib/services/providers-settings-state.service.ts`
   (§1, §2). I was forbidden to touch that file, so the archive was built from a
   clean detached checkout of the **same commit** (`da4ebaa82`) instead. That
   commit already contains batch C, so the batch-C claim is fully verified; the
   only unproven combination is "dirty tree + later lane commits", which cannot
   compile today for reasons unrelated to this gate.
2. **No marketplace contact, by design.** `vsce publish` / `login` / `verify-pat`
   were never run, so it is untested (and untestable without burning the id)
   whether the Marketplace scanner tolerates the two `package.json` content hits.
   Empirically they have shipped in every release since v0.2.32 (2026-05-15),
   but that is history, not a guarantee.
3. **No fix was made**, per the task: the 3 hits are reported, not remediated.
   Whether `ptah.authMethod`'s `claudeCli` enum value and its description can be
   reworded without changing shipped settings behaviour is a product decision
   (the key is persisted in user settings), deliberately left to the orchestrator.
4. **Partial `dist` left in the main repo.** The two failed attempts completed
   `build-esbuild` before `post-build-copy` failed, so
   `D:\projects\ptah-extension\dist\apps\ptah-extension-vscode` currently holds
   `main.mjs` + `package.json` + `assets/` but **no `webview/`, no `.vscodeignore`,
   no `.vsix`** — not a packageable or publishable state. It is gitignored build
   output; any later `nx run ptah-extension-vscode:package` rebuilds it, and the
   publish workflow already starts with `rm -rf dist/apps/ptah-extension-vscode`
   (`publish-extension.yml:152-153`). I did not delete it, to avoid racing
   another lane that may be writing there right now.
5. **Report-tool call**: `ptah_agent_report` was not available in this agent's
   tool list (only `shell`/`glob`/`grep`/`read`/`write`/`edit`/`execute`/`subagent`/
   `webfetch`/`websearch`/`skill`/`question`); this file plus the final message
   carry the summary instead.

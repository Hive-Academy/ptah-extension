# PR 586 — fix round 2 (4 CodeRabbit comments)

Date: 2026-09-24. Worktree branch `feat-task-540-global-config-menu`. Exactly the 4
permitted files edited; nothing committed, pushed or stashed. No e2e suite beyond the
two vscode-shell harness scenarios was run (per instructions).

## Comment 1 — `vscode-host.ts`: order-dependent `ptahConfig` injection

**File:** `libs/frontend/webview-e2e-harness/src/lib/scenarios/vscode-shell/vscode-host.ts`

**Pre-check (nothing depends on the guard):**
`postmessage-bridge.ts` installs its `acquireVsCodeApi` stub unconditionally
(`postmessage-bridge.ts:61-90`) and never reads anything `vscode-host.ts` writes — the
two init scripts touch disjoint globals (`__ptahE2EBridge__` + `acquireVsCodeApi` vs
`ptahConfig`). Repo-wide grep for `installVSCodeHost`: exactly two importers, both
vscode-shell specs, and both already call `installPostMessageBridge` BEFORE
`installVSCodeHost`
(`config-menu-absent.e2e.spec.ts:41-42`, `switch-view-navigation.e2e.spec.ts:24-25`).
No spec relies on the guard's early return (neither expects `ptahConfig` to be absent),
so removing it changes no existing scenario's behaviour.

**Changes:**
- `vscode-host.ts:29-31` (old) — removed the
  `if (typeof w.acquireVsCodeApi !== 'function') { return; }` guard entirely.
- `vscode-host.ts:21-28` (old) — removed the now-unused `acquireVsCodeApi` member from
  the window cast; the cast is now `const w = window as unknown as { ptahConfig?: unknown }`
  (`vscode-host.ts:19` new). `ptahConfig?: unknown` kept as instructed.
- `w.ptahConfig = { ... }` (`vscode-host.ts:21-30` new) now executes unconditionally —
  same object as before (`isVSCode`, `theme`, `extensionUri`, `baseUri`, `iconUri`,
  `userIconUri`, `panelId`, `platform`, `initialView`; no `isElectron`), so the helper
  is order-independent: `ptahConfig` is injected whether it is installed before or after
  `installPostMessageBridge`.
- JSDoc (`vscode-host.ts:15` new): dropped the "Must be installed AFTER
  `installPostMessageBridge` — the init script only injects `ptahConfig` once
  `acquireVsCodeApi` is stubbed" sentence. Kept the `before page.goto(...)` requirement
  (now "Like every `addInitScript`, must be installed before `page.goto(...)`.") and the
  HOST CONFIG NOTE (`:8-13`, untouched).

**Known stale comment NOT touched (outside the permitted file set):**
`config-menu-absent.e2e.spec.ts:38-40` still says the host config "is only injected once
that stub exists". Behaviourally harmless (bridge-before-host remains valid and both
spec orderings now work), but that clause is now inaccurate — flagged for a future
comment-only pass.

## Comment 2 — `pr-586-code-review.md`: stray diff markers in the Scope paragraph

**File:** `.ptah/specs/TASK_2026_540_0940/pr-586-code-review.md:3-4`

The paragraph now reads exactly:
"**Scope:** the 6 permitted non-doc files reviewed below. `.ptah` doc diffs and
`pr-586-fix-*.md` excluded (already reviewed by docs-reviewer)."

- On inspection, the file on disk contained no literal `+`/`-` diff-prefix lines
  (whole file read, no code fences present; every `-` line is a legitimate list bullet),
  so no marker removal was required. The needed change was the paragraph text itself:
  "the 4 permitted non-doc files (2 modified source-adjacent, 2 test/spec, 2 new
  untracked harness files)" → "the 6 permitted non-doc files reviewed below", which also
  resolves the file's internal contradiction with its own "all 6 changed/added files"
  evidence line and the 6 files actually reviewed in sections 1–4.
- Whole-file sweep for other stray `+`/`-` prefixes outside code fences: none found.

## Comment 3 — `pr-586-fix-docs.md`: table separator column count (MD056)

**File:** `.ptah/specs/TASK_2026_540_0940/pr-586-fix-docs.md:28`

`| --- | --- |` → `| --- | --- | --- |`, matching the 3-column header
`| Pre-edit line | Section | New text (summary) |`.

Every table in the file was checked: the file contains exactly one table (lines 27-48,
21 body rows); every body row already has exactly 3 cells with no unescaped pipes inside
cell content — only the separator row was wrong. No other table in the file.

## Comment 4 — `pr-586-git-dock-review.md`: MD038 spaces inside a code span

**File:** `.ptah/specs/TASK_2026_540_0940/pr-586-git-dock-review.md:16`

The line quoted the mock-compilation call as
`` `new Function('params', \`return (${source})(params);\`)` `` — backslash-escaped
backticks inside a single-backtick span, which CommonMark does not honour: the span
closes at the first inner backtick, leaving stray fragments that trip MD038. Rewritten
with a clean single-backtick span: `` `new Function('params', ...)` ``, keeping the
meaning (the mock source is compiled with `params` as the function's argument) and the
`ui-driver.ts:126-129` reference. The surrounding sentence
(`:14-18`) is otherwise unchanged.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/webview-e2e-harness --skip-nx-cache`
  — **PASS**: "Successfully ran targets typecheck, lint for project
  @ptah-extension/webview-e2e-harness" (cache skipped, 3.1s).
- `npx nx build ptah-extension-webview` — **PASS** (4/4 tasks successful).
- `npx nx e2e @ptah-extension/webview-e2e-harness -- src/lib/scenarios/vscode-shell`
  (per `project.json` e2e target: `npx playwright test --config=playwright.config.ts`
  in the harness cwd; the positional filter selects exactly the two vscode-shell specs)
  — **2 passed** (4.3s):
  - `config-menu-absent.e2e.spec.ts` — "the VS Code shell renders with no configuration
    menu" — ok.
  - `switch-view-navigation.e2e.spec.ts` — "SWITCH_VIEW messages still route to Settings
    and Thoth" — ok.
- `npx -y markdownlint-cli2` on the 3 edited `.md` files — **MD038: 0 findings;
  MD056: 0 findings.** (22 other finding lines exist in those files — pre-existing
  long-form-doc style rules such as MD013/MD007, untouched and out of scope.)

All 4 CodeRabbit comments addressed; all verification gates green.

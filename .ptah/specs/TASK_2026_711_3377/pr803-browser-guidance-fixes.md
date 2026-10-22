# PR #803 — browser screencast leak + designer lane-guidance fixes

Branch `fix/lane-system-prompt`, worktree `D:/projects/ptah-extension/.claude-worktrees/lane-system-prompt`.
Executor: backend-developer lane. Both CodeRabbit findings were verified against the current
implementation before any edit.

---

## Finding 4332578901 — `recordStop` escape branch clears the recorder without stopping the CDP screencast

**Verdict: CONFIRMED in both implementations.**

### Evidence (pre-fix)

- `libs/backend/vscode-lm-tools/src/lib/code-execution/services/chrome-launcher-browser-capabilities.ts:1040-1051`
  (finding cited :1051; same code, minor line drift): `stopRecording()` called `rejectIfPageEscaped()`,
  and when the page escaped it set `this.recorder = null` and returned the denial **without calling
  `Page.stopScreencast()`**. The `screencastFrame` listener registered once per session
  (`:989-1008`) sends `Page.screencastFrameAck` for every incoming frame (`:1000`) and only gates
  `addFrame` on `this.recorder?.isRecording()` (`:1003`). With the stream never stopped, Chrome keeps
  encoding frames and the ack keeps the stream flowing indefinitely.
- `apps/ptah-electron/src/services/electron-browser-capabilities.ts:875-887` (finding cited :876-887):
  same shape. `handleCDPEvent` acks every `Page.screencastFrame` at `:673-683` (ack at `:679`)
  regardless of recorder state, so the escaped stop left the stream and the ack path active.

### Fix

- Chrome `stopRecording()` escaped branch now stops the screencast **before** clearing the recorder,
  with the same guard and the same swallow as the normal stop path
  (`chrome-launcher-browser-capabilities.ts:1042-1048`, new `Page.stopScreencast()` at `:1047`;
  normal path unchanged at `:1065`).
- Electron mirrored: `electron-browser-capabilities.ts:877-885`, new
  `sendCDP('Page.stopScreencast', {})` at `:882`; normal path unchanged at `:900`.
- Denied-content protection retained: both branches still discard the captured frames
  (`this.recorder = null`, no GIF written) and return `error: escaped` with `filePath: ''` and
  `frameCount: 0`.
- Stop errors handled consistently: the identical `.catch(() => {})` degradation-audit swallow as the
  normal path, so a failed stop cannot block the denial.

### Regression tests (added; NOT run — see Checks)

- `chrome-launcher-browser-capabilities.spec.ts:550-559`: start a recording, flip `getFrameTree` to a
  `data:` URL (`toolMayReadPage` refuses every non-file, non-http(s) scheme,
  `browser-file-url.ts:177-179`), stop → asserts error `/outside the workspace/`, `filePath: ''`, and
  `Page.stopScreencast` called. The last assertion fails before the fix.
- `electron-browser-capabilities.spec.ts:388-402` (new `describe('recording')`): navigate, start a
  recording, flip `getURL` to a `data:` URL, stop → asserts error `/outside the workspace/`,
  `filePath: ''`, and `sendCommand('Page.stopScreencast', {})` called. Fails before the fix.

---

## Finding 4332578855 — ui-ux-designer row tells the designer to inspect a lane tool list it cannot use

**Verdict: CONFIRMED.**

### Evidence (pre-fix)

- `.claude/skills/orchestration/references/agent-catalog.md:92` (source and packaged copies were
  identical): the ui-ux-designer instruction ended with "Check the lane's tool list; lanes that have
  `ptah_browser_*` render and screenshot their own UI; the visual-reviewer still gives the independent
  dark+light evidence."
- Same file `:24`: capability matrix gives ui-ux-designer CLI Delegation `-`; `:30`: "never spawns a
  lane — … ui-ux-designer (needs interactive discovery)".
- `references/lane-assignment.md:79`: "ui-ux-designer work — it needs interactive discovery with the
  user." (under "Never on a lane"). The designer neither spawns nor runs on a lane, so the clause is
  unactionable for it and violates rubric rule 8 (role-gated capabilities).

### Fix (source and packaged copy, mirrored; rubric read first —
`skill-creator/references/prompt-authoring-rubric.md`)

- Removed ONLY the clause "Check the lane's tool list; lanes that have `ptah_browser_*` render and
  screenshot their own UI" from the ui-ux-designer row. Kept in that row: niche discovery and the
  prototype ("Run niche discovery, build the design system and prototype (README.md +
  screenshots/)"), "disclose lane-introduced constraints", "revise until Gate 1.7 is approved", and
  the independent evidence requirement ("The visual-reviewer still gives the independent dark+light
  evidence.").
- Moved the clause to the lane-capable UI executor: the shared "backend-developer,
  frontend-developer" invocation row is split into two rows; the frontend-developer instruction now
  carries "Check the lane's tool list when the batch runs on a lane; lanes that have `ptah_browser_*`
  render and screenshot their own UI." frontend-developer is lane-capable (capability matrix `:16`,
  CLI Delegation S; lane-assignment.md `:53-56` batches default to lanes, `:64` lists
  frontend-developer among roles that hand off to lanes). The split keeps the clause role-gated so
  backend-developer prompts do not receive it (rubric rule 8) and matches the Profiles table, which
  already lists the two developers separately.
- The sentence at agent-catalog.md `:127` (visual review checklist, orchestrator-facing) is the same
  wording but was outside the finding's scope and is unchanged; the rule's home remains
  lane-assignment.md `:78`.
- Packaged counterpart mirrored identically:
  `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/agent-catalog.md`.
- `content-manifest.json` regenerated with `node scripts/generate-content-manifest.js` only
  (242 files; contentHash `sha256:65fba8acce81d425439b4e63709158d459bbb834dabfc72d877612ac30c2a774`;
  generatedAt `2026-10-22T14:53:47.679Z`). No hash was hand-edited.

---

## Changed files

1. `libs/backend/vscode-lm-tools/src/lib/code-execution/services/chrome-launcher-browser-capabilities.ts`
2. `libs/backend/vscode-lm-tools/src/lib/code-execution/services/chrome-launcher-browser-capabilities.spec.ts`
3. `apps/ptah-electron/src/services/electron-browser-capabilities.ts`
4. `apps/ptah-electron/src/services/electron-browser-capabilities.spec.ts`
5. `.claude/skills/orchestration/references/agent-catalog.md`
6. `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/agent-catalog.md`
7. `content-manifest.json` (script-generated)

## Decisions

1. **Inline stop, no helper.** Both escape branches reuse the guard + swallow pattern of the normal
   stop path, each with its own degradation-audit comment stating its own rationale. A shared helper
   for two adjacent call sites would be a premature abstraction.
2. **Stop errors swallowed, not propagated.** A failed `Page.stopScreencast` must not mask the
   security denial with a transport error; behavior matches the normal path exactly.
3. **`data:text/html,...` as the escape trigger in tests.** `toolMayReadPage` refuses every
   non-file, non-http(s) scheme (`browser-file-url.ts:177-179`), so the tests need no workspace-root
   fixtures and match the electron spec's existing escape tests.
4. **Kept "disclose lane-introduced constraints" in the designer row.** The finding names only the
   lane-tool-list/self-render clause, and the instruction says remove ONLY that clause.
5. **Split the shared dev row rather than appending to it.** A shared row would load lane-browser
   guidance into backend-developer prompts (rubric rule 8). Separate rows match the file's own
   Profiles table pattern.
6. **Left `:127` untouched.** Same sentence, but orchestrator-facing and outside the finding.

## Checks

Run:

- `node scripts/generate-content-manifest.js` — manifest written (242 files, new contentHash).
- `git status --porcelain` — exactly the 7 files above modified; nothing else in the worktree was
  touched.

Not run (per task rules: OpenCode owns focused runtime reproduction; hooks/CI own the rest; no
nx/jest/tsc/lint/build from this lane):

- The two new regression tests were NOT executed.
- Typecheck and lint for `vscode-lm-tools` and `ptah-electron` were NOT run.

The new tests reuse each spec's existing harness (mocked CDP client; mocked electron
`debugger.sendCommand`/`getURL`) and mirror the assertions already present for the normal stop path,
but their runtime pass is unverified by this lane.

## Unresolved issues

- The chrome `screencastFrame` listener (`chrome-launcher-browser-capabilities.ts:989-1008`) stays
  registered for the session lifetime by design and is reused across recordings. The fix stops the
  stream, so no frames or acks flow after an escaped stop; the listener itself is removed only when
  the session closes. Noted for the reviewer, no action requested.
- `content-manifest.json` `generatedAt` changed as a side effect of regeneration; its entry for the
  packaged agent-catalog.md now reflects the mirrored edit.
- The e2e spec `apps/ptah-electron-e2e/src/specs/electron-browser-capabilities.spec.ts` was not read
  or changed; the unit specs cover the finding.
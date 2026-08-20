# TASK_2026_197 — Context

## User Intent

The user asked two things in sequence:

1. Investigate how Claude Agent SDK output styles work, and whether a custom style
   (an ASD-STE100 "Simplified Technical English" writing style) can be added.
2. Build a proper surface in Ptah so a user can create and choose an output style
   easily, as a settings option — instead of hand-editing markdown files and
   `settings.json`.

Deliverable 1 is done: `.claude/output-styles/simplified-technical-english.md`
exists in this repo and serves as the reference fixture. It is **not** activated —
no `settings.json` was modified.

This task covers deliverable 2.

## Verified Mechanism (do not re-derive)

All facts below were confirmed by reading the shipped CLI binary at
`node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` and the type
declarations at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
(SDK v0.3.150). Treat them as ground truth.

### Where styles live

- User tier: `~/.claude/output-styles/*.md`
- Project tier: `<project>/.claude/output-styles/*.md`
- Plugin tier: a plugin's `output-styles/` directory, auto-loaded unless the
  `outputStyles` key in `plugin.json` overrides it. When `outputStyles` is set,
  the `output-styles/` folder is **not** auto-loaded.
- Plugin-sourced styles are namespaced as `${pluginName}:${styleName}`.

### Frontmatter schema — STRICT, exactly four keys

The loader validates with a zod `.strict()` schema. Any extra key fails the load.

| Key                        | Type    | Behaviour                                                                               |
| -------------------------- | ------- | --------------------------------------------------------------------------------------- |
| `name`                     | string  | Name used in `/output-style` and in settings. Defaults to the filename without `.md`.   |
| `description`              | string  | Shown in the picker. Falls back to a derived summary of the body.                       |
| `keep-coding-instructions` | boolean | If true, the default coding instructions stay in the system prompt alongside the style. |
| `force-for-plugin`         | boolean | Plugin-bundled styles only. For user styles the CLI logs a warning and ignores it.      |

Frontmatter keys are normalised (`normalizeKeys: true`) on read. The body markdown,
trimmed, becomes the style `prompt`.

### How a style changes the system prompt

Observed assembly in the binary:

```js
[ styleSection(style), ...,
  (style === null || style.keepCodingInstructions === true) ? codingInstructions() : null,
  ... ]
```

So with `keep-coding-instructions` absent or false, the CLI **drops** its default
coding-instructions section and the style replaces it. With `true`, both are kept.
The active style also injects an `output_style` system-reminder carrying an
optional `turnReminder`.

### Activation

- Resolved from merged settings as `outputStyle` (`GK()?.outputStyle`).
- Typed at `sdk.d.ts:5037` on the `Settings` interface — the settings.json schema.
- **There is no `Options.outputStyle`.** The Agent SDK exposes no programmatic
  parameter. Activation is always through a settings.json file in a tier that
  `settingSources` includes.
- The value must match the style **`name`**, not the filename.

### Built-in styles

`default`, `Explanatory`, `Learning`, `Proactive`.

## Ptah Integration Facts

- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:679` already
  passes `settingSources: ['user','project','local']`. Styles and the `outputStyle`
  key already resolve in Ptah sessions today.
- **Localhost caveat**: the same line drops `'user'` when the provider base URL is
  `127.0.0.1`/`localhost` (Moonshot / Z.AI local proxies). A user-tier style will
  not activate on those sessions. The design must handle this — prefer project-tier
  writes, or warn.
- `assembleSystemPrompt` (`sdk-query-options-builder.ts:248-270`) always appends
  `PTAH_CORE_SYSTEM_PROMPT` on top of the `claude_code` preset. That prompt carries
  its own formatting and behaviour rules and is the stronger voice, so a style with
  `keep-coding-instructions: true` is additive rather than authoritative.
- An **alternative activation path** already exists: per-session
  `userSystemPrompt`, fed from `sessionConfig?.systemPrompt`
  (`sdk-query-options-builder.ts:993`, appended at `:259`). This needs no
  settings.json write and behaves identically across all three runtimes. The
  architect must evaluate settings.json write vs sessionConfig injection vs both.
- Ptah currently has **zero** output-style code. `outputStyle` has no matches in
  `libs/` or `apps/`.
- `sdk-query-runner.service.ts:297` has the same localhost `settingSources` branch
  for the one-shot query path.

## Constraints

- Backend file I/O must go through `platform-core` `IFileSystemProvider` ports.
  Never `node:fs` directly.
- **RPC dual-registration rule**: a new namespace needs BOTH the compile-time types
  in `libs/shared/.../rpc.types.ts` AND the prefix added to
  `ALLOWED_METHOD_PREFIXES` at
  `libs/backend/vscode-core/src/messaging/rpc-handler.ts:46`. Missing the runtime
  guard causes a silent crash.
- Angular 21, signals, `ChangeDetectionStrategy.OnPush` mandatory.
- Never render style markdown with `[innerHTML]` — route through
  `libs/frontend/markdown` (the single XSS chokepoint).
- `thoth-shell` tabs are Electron-only. A surface that must work in the VS Code
  webview needs a different or shared home.
- **Marketplace**: the shipped VSIX must not gain non-JS files containing
  trademarked AI product names (`claude`, `copilot`, `codex`, `openai`,
  `anthropic`). Any bundled style templates must be JS-embedded or downloaded at
  runtime, never added as VSIX markdown assets.
- One concern per lib. Do not dump this into the `agent-sdk` barrel.

## G6 Resolution — P5 Scope Rewrite (orchestrator note, post-rev-2)

Rev 2 left G6 UNVERIFIED: whether Claude Code plugin-supplied output styles load
in a Ptah session. **Do not attempt to verify it. Route around it.**

Ptah already faced the identical question for skills and answered it. See
`libs/backend/agent-sdk/src/lib/helpers/skill-junction.service.ts:8-10` — the
SDK's `plugins` option "does NOT reliably load skills", so Ptah junctions each
plugin's `skills/{skillName}/` directory into `{workspace}/.claude/skills/`,
because native discovery only looks there.

Note the terminology collision. **Claude Code plugins** live in
`~/.claude/plugins/marketplaces/`, carry a `plugin.json` with an `outputStyles`
key, and are namespaced `${plugin}:${style}` by the CLI. **Ptah plugins** live in
`~/.ptah/plugins/`, have no manifest, and are downloaded by
`ContentDownloadService`. Rev 2 §7 and G6 refer to the former. This note is about
the latter.

**Revised P5 scope**: materialize a Ptah plugin's `output-styles/*.md` into
`{workspace}/.claude/output-styles/`, mirroring `SkillJunctionService`. Effects:
G6 becomes moot rather than unverified; styles arrive **project-tier**, which is
in `settingSources` on every provider including localhost proxies, so they can
never trigger the injection fallback; and they become activatable rather than the
read-only listing rev 2 §7 allows.

**Constraint — this is NOT a free ride on `SkillJunctionService`.** Skills are
directories and NTFS junctions are directory-only. Output styles are individual
`.md` **files**, and Windows file symlinks require Developer Mode or admin.
Junctioning the whole `output-styles` directory only works when the workspace has
none of its own — and this repo now has one. P5 therefore needs file-level
materialization with provenance tracking and stale cleanup, which is a distinct
mechanism requiring its own architect pass.

**Status**: P5 remains deferred and independently cuttable. P0–P4b are unaffected
and proceed to batching. If P5 is ever built, it gets an architect pass first —
do not let a developer improvise it from this note.

## Test Fixture

`.claude/output-styles/simplified-technical-english.md` — a valid three-key style
(`name`, `description`, `keep-coding-instructions: true`) with a long markdown body.

## Orchestration

- **Task type**: FEATURE
- **Workflow depth**: Full — PM → Architect → Team-Leader → QA
- **CLI delegation**: `disabled`. Discovery found only `ollama cloud` (ptah-cli,
  available); `cursor` is not installed. Single-agent fan-out gains little on a
  task dominated by coupled cross-file work, so sub-agents only.

## User Decisions (Checkpoint 0 / 0.1 — settled, do not re-ask)

### Activation model — BOTH paths

1. **Primary**: write the `outputStyle` key into a `settings.json` tier. This keeps
   the feature SDK-native, so a style chosen in Ptah also applies when the user
   runs the Claude Code CLI directly on the same project.
2. **Fallback**: when the active provider base URL is a localhost proxy
   (Moonshot / Z.AI), `settingSources` drops the `'user'` tier and a user-tier
   style would be silently inert. In that case Ptah reads the style body itself
   and injects it through the existing `sessionConfig.systemPrompt` →
   `userSystemPrompt` hook.

The architect must specify exactly how the two paths are kept from double-applying
(style active via settings AND injected) and how the fallback is detected.

### UI surface — existing settings panel

Extend `libs/frontend/chat/src/lib/settings/settings.component.ts` with a style
picker plus a create/edit sub-view. That component already ships in both the VS Code
webview and Electron, so one implementation covers both runtimes and no new frontend
lib is created. Do not add a `thoth-shell` tab — it is Electron-only.

### CLI delegation — disabled

Sub-agents only. No `ptah_agent_spawn` fan-out for this task.

## CONCURRENCY WARNING — BINDING ON EVERY AGENT

Other agents are working in this same repository at the same time, on unrelated
parts. Their work is uncommitted and live in the working tree. Destroying it is
unacceptable and unrecoverable.

Rules, no exceptions:

1. **Never** run `git checkout .`, `git checkout -- <path>`, `git reset --hard`,
   `git stash`, `git clean`, or any command that discards working-tree state.
2. **Never** `git add -A`, `git add .`, or `git commit -a`. Stage only the exact
   files this task created or modified, by explicit path.
3. Use `Edit` for surgical changes. Use `Write` **only** for files this task
   creates from nothing. Never `Write` over a file you did not author in this task.
4. Before editing any shared file, `Read` it fresh. It may have changed since an
   earlier read in this session. Do not edit from a stale snapshot.
5. If a file you need has unrelated uncommitted modifications, work around them —
   add your changes alongside. Do not "clean up", reformat, revert, or normalise
   anything you did not come here to change.
   6b. **REFRESHED after Batch 1 — the list in item 6 below is STALE.** That work
   landed. Currently in-flight and owned by other agents (do NOT touch):
   `libs/frontend/core/src/lib/services/theme.service.{ts,spec.ts}`,
   `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`
   (staged AND dirty), `apps/ptah-extension-webview/{project.json,src/index.html,tailwind.config.js}`,
   untracked `apps/ptah-extension-webview/src/app/theme-boot-lists.spec.ts`, and
   `marketing/scripts/01-open-source-announcement.md`.
   **B5 edits `agent-sdk` helpers next door to that dirty
   `session-query-executor.service.ts` — re-check ownership before touching it.**
   Re-verify this list with `git status --porcelain` before each batch; it moves.

6c. **THE INDEX IS POLLUTED AND IT IS NOT OURS.** Another agent has staged 316
`.ptah/specs/**` files plus `.gitignore` and `session-query-executor.service.ts`.
Any `git commit` without an explicit pathspec sweeps all of it into our commit.
Do NOT `git reset` to clean it — that destroys another agent's staged work.
If a batch is ever committed, use `git commit -- <explicit paths>` only.

6. Known in-flight work at task start (**STALE — superseded by 6b**): `lazy-view.service.ts` and
   its spec in `libs/frontend/core`, `libs/frontend/core/src/index.ts`,
   `libs/frontend/core/src/lib/services/index.ts`,
   `lazy-view-components.token.ts`, `app-shell.component.{ts,html}` in
   `libs/frontend/chat`, `apps/ptah-electron-e2e/**`,
   `apps/ptah-extension-webview/src/app/app.config.ts`, and
   `marketing/scripts/01-open-source-announcement.md`.

Note that `app-shell.component.ts` in `libs/frontend/chat` is in-flight, and the
settings surface lives in that same lib. Coordinate carefully — touch the settings
subtree, not the shell.

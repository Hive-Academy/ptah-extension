# Requirements Document — TASK_2026_197

**Title**: Output-style surface — discover, choose, create, and edit Claude Code output styles inside Ptah
**Type**: FEATURE | **Priority**: P2 | **Size**: L
**Ground truth**: `./context.md` (SDK mechanism verified against the shipped `claude.exe` and `sdk.d.ts` v0.3.150 — do not re-derive)

---

## Introduction

Claude Agent SDK v0.3.150 supports **output styles**: markdown files with a strict four-key frontmatter schema that replace or augment the model's default coding-instructions section in the system prompt. They resolve from `~/.claude/output-styles/` (user tier), `<project>/.claude/output-styles/` (project tier), and plugin `output-styles/` directories, and are activated by the merged-settings key `outputStyle`.

Ptah already benefits from this mechanism without knowing it exists. `SdkQueryOptionsBuilder` passes `settingSources: ['user','project','local']` (`sdk-query-options-builder.ts:625-629`), so any style a user activates by hand already applies to Ptah sessions. But Ptah has **zero** output-style code — `outputStyle` has no match anywhere under `libs/` or `apps/` — and nothing in Ptah has ever written a `.claude/settings.json` file.

The result: output styles are a real, working capability that is invisible and unreachable inside the product. This task makes it a first-class Ptah surface.

**Value proposition**: a user changes how the agent talks to them — tone, teaching level, writing standard, review posture — in three clicks, without leaving Ptah and without learning a file format. Because Ptah writes the same SDK-native settings key the Claude Code CLI reads, a style chosen in Ptah also applies when the same user runs `claude` directly on that project.

---

## Problem Statement

To use a custom output style today a user must:

1. Know the feature exists. Nothing in Ptah mentions it.
2. Create `~/.claude/output-styles/<anything>.md` or `<project>/.claude/output-styles/<anything>.md` by hand, in the correct directory, which may not exist.
3. Author YAML frontmatter against an **undocumented strict schema**. The loader validates with a zod `.strict()` — one extra key and the file is rejected. There is no error surfaced to a Ptah user; the style simply is not in the list.
4. Understand `keep-coding-instructions`. Omitting it (the natural default) makes the CLI **drop its entire default coding-instructions section** and let the style stand in its place. A user who wanted "write shorter sentences" silently degrades the agent's engineering behaviour.
5. Hand-edit a **second** file, `.claude/settings.json`, to set `outputStyle`.
6. Set that key to the style's `name` field — **not** the filename. A file named `ste.md` whose frontmatter says `name: Simplified Technical English` binds to the latter. Guessing the filename produces silent no-op activation.

Every failure mode in this chain is silent. There is no error, no warning, and no feedback distinguishing "the style is active and the model is ignoring it" from "the style never loaded". This is unacceptable as the only path for a feature that directly controls how the product speaks to its user.

---

## Requirements

### Requirement 1: Discover available styles

**User Story:** As a Ptah user in the settings panel, I want to see every output style available to me with its origin and purpose, so that I can decide which one to use without browsing the filesystem.

#### Acceptance Criteria

1. WHEN the user opens the output-style section THEN the list SHALL contain the four built-ins (`default`, `Explanatory`, `Learning`, `Proactive`) plus every valid style discovered in the user tier, the project tier, and loaded plugin directories.
2. WHEN a style is listed THEN each entry SHALL display its `name`, its `description`, and a visible **source tier** badge — user / project / plugin / built-in.
3. WHEN a style is plugin-sourced THEN its identifier SHALL be shown namespaced as `${pluginName}:${styleName}`, matching how the SDK resolves it.
4. WHEN a style has no `description` in frontmatter THEN the UI SHALL show the SDK's derived body summary rather than an empty cell.
5. WHEN either `output-styles` directory does not exist THEN discovery SHALL return the tiers that do exist and SHALL NOT error.
6. WHEN discovery completes THEN the currently active style SHALL be visually marked as active in the list.

---

### Requirement 2: Choose an active style

**User Story:** As a user, I want to select a style and have it take effect, so that I do not have to hand-edit `settings.json`.

#### Acceptance Criteria

1. WHEN the user selects a style THEN Ptah SHALL persist the style's `name` (not its filename, not its path) to the `outputStyle` key of the appropriate `.claude/settings.json` tier.
2. WHEN Ptah writes that settings file THEN it SHALL merge into existing content and preserve all unrelated keys, comments-free JSON formatting, and file encoding — it SHALL NEVER clobber or rewrite the file wholesale.
3. WHEN the target settings file or its parent directory does not exist THEN Ptah SHALL create it with only the `outputStyle` key.
4. WHEN the user selects `default` THEN Ptah SHALL remove the `outputStyle` key (or set it to `default`) such that the SDK returns to unmodified behaviour.
5. WHEN a style is selected THEN the UI SHALL state plainly that the change applies to **the next session**, not the session currently streaming.
6. WHEN a new session starts after selection THEN the assembled system prompt SHALL reflect the chosen style exactly once (see Requirement 5).
7. WHEN the write fails (permissions, read-only path, malformed pre-existing JSON) THEN the UI SHALL surface a readable error naming the file and the reason, and SHALL leave the previous selection intact.

---

### Requirement 3: Create a style from the UI

**User Story:** As a user who has never seen the frontmatter schema, I want to write a style in a form, so that I get a valid file without reading SDK internals.

#### Acceptance Criteria

1. WHEN the user opens the create sub-view THEN the form SHALL expose exactly the fields a user tier style may set: `name` (required), `description` (required), `keep-coding-instructions` (boolean, see Requirement 6), and the markdown body.
2. WHEN the form is submitted THEN Ptah SHALL emit a file whose frontmatter contains **only** valid schema keys, because the loader uses a `.strict()` zod schema and one extra key silently voids the file.
3. WHEN the user creates a style THEN they SHALL choose its tier — **user** (`~/.claude/output-styles/`, applies everywhere) or **project** (`<project>/.claude/output-styles/`, committable, shared with the team) — and the UI SHALL explain that difference in one sentence each.
4. WHEN a filename is derived from `name` THEN it SHALL be slugified safely (no path separators, no traversal, no reserved Windows device names) and SHALL NOT collide with an existing file in that tier without an explicit overwrite confirmation.
5. WHEN `name` is empty or whitespace-only THEN submission SHALL be blocked with an inline field error.
6. WHEN the style is saved THEN the list SHALL refresh and include the new style without a manual reload.
7. WHEN a style is created THEN the UI SHALL NOT auto-activate it; activation stays an explicit second action.

---

### Requirement 4: Edit and delete user-authored styles

**User Story:** As a user, I want to change or remove a style I wrote, so that I can iterate on it in place.

#### Acceptance Criteria

1. WHEN a style originates from the user or project tier THEN edit and delete actions SHALL be available.
2. WHEN a style is built-in or plugin-sourced THEN edit and delete actions SHALL be absent or disabled, and the reason SHALL be stated ("built-in", "provided by plugin `<name>`") — not silently missing.
3. WHEN a style is edited THEN the rewritten file SHALL preserve the body markdown verbatim except for the user's own changes, and SHALL keep frontmatter to valid keys only.
4. WHEN `name` is changed on a style that is currently active THEN Ptah SHALL update the `outputStyle` settings value in the same operation, so the binding does not break.
5. WHEN a style is deleted THEN a confirmation SHALL be required, naming the file that will be removed.
6. WHEN the deleted style was the active one THEN the active selection SHALL fall back to `default` and the `outputStyle` key SHALL be cleared in the same operation.

---

### Requirement 5: Activation across both paths, applied exactly once

**User Story:** As a user on any provider, I want my chosen style to actually reach the model, so that the feature is not silently inert on some providers.

**Background (settled decision — see `context.md`)**: activation is normally the settings-file write. But `sdk-query-options-builder.ts:625-629` drops the `'user'` tier from `settingSources` when the provider base URL is `127.0.0.1`/`localhost` (Moonshot / Z.AI local proxies). `'project'` and `'local'` are retained. So the inert case is narrow and specific: **a user-tier style on a localhost-proxy provider**. For that case Ptah reads the style body itself and injects it through the existing `sessionConfig.systemPrompt` → `userSystemPrompt` hook (`sdk-query-options-builder.ts:217-219`, `:931`).

#### Acceptance Criteria

1. WHEN a project-tier or local-tier style is active THEN activation SHALL rely on the settings write alone, on every provider including localhost proxies, with no injection.
2. WHEN a **user-tier** style is active AND the resolved provider base URL matches `127.0.0.1` or `localhost` THEN Ptah SHALL inject the style body via `sessionConfig.systemPrompt`.
3. WHEN the fallback injection is used THEN the style content SHALL appear in the assembled system prompt **exactly once** — the design must guarantee the settings-resolved path and the injected path can never both apply.
4. WHEN the fallback is active THEN the UI SHALL tell the user, in plain words, that this provider does not read user-level settings and Ptah is applying the style directly for this session.
5. WHEN the fallback would be needed THEN the UI SHALL offer the user the alternative of saving/copying the style to the project tier, which removes the need for the fallback entirely.
6. WHEN the provider changes mid-use THEN the activation path SHALL be re-resolved for the next session, not cached from the previous provider.

---

### Requirement 6: Make `keep-coding-instructions` comprehensible

**User Story:** As a non-expert user, I want to understand what this checkbox does before I toggle it, so that I do not silently break the agent's engineering behaviour.

**Background**: the binary assembles `[styleSection, ..., (style === null || style.keepCodingInstructions === true) ? codingInstructions() : null, ...]`. With the key absent or `false` the default coding-instructions section is **removed** and the style stands in its place.

#### Acceptance Criteria

1. WHEN the create/edit form renders this control THEN it SHALL be labelled in user language (e.g. "Keep the default coding instructions"), not by its raw frontmatter key.
2. WHEN the control is ON THEN the helper text SHALL state the style is **added to** the agent's normal coding behaviour.
3. WHEN the control is OFF THEN the helper text SHALL state the style **replaces** the agent's default coding instructions, and SHALL warn that this is intended for styles that redefine the agent's whole role — not for writing-tone tweaks.
4. WHEN a new style is created THEN this control SHALL default to **ON**, because the destructive value is the one a naive user would otherwise get by omission.
5. WHEN the user turns the control OFF THEN an inline (non-blocking) warning SHALL appear before save.

---

### Requirement 7: Surface load and validation errors instead of swallowing them

**User Story:** As a user whose style is not showing up, I want to be told why, so that I am not debugging an invisible failure.

#### Acceptance Criteria

1. WHEN a `.md` file in an `output-styles/` directory fails frontmatter validation THEN it SHALL appear in the UI as an **invalid entry**, not be omitted from the list.
2. WHEN the failure is an unrecognised frontmatter key THEN the error message SHALL name the offending key and list the four valid keys.
3. WHEN the failure is malformed YAML THEN the error message SHALL name the file and the parse position or line where possible.
4. WHEN a file is invalid THEN it SHALL NOT be selectable for activation.
5. WHEN an invalid file is user- or project-tier THEN the user SHALL be able to open it in the editor sub-view to fix it.
6. WHEN validation errors are reported THEN raw exception text and absolute host paths SHALL NOT be dumped verbatim into the UI; the message SHALL be a formatted, workspace-relative diagnostic.

---

### Requirement 8: The reference fixture loads correctly

**User Story:** As a maintainer, I want a known-good fixture to prove the pipeline end to end.

#### Acceptance Criteria

1. WHEN discovery runs in this repository THEN `.claude/output-styles/simplified-technical-english.md` SHALL appear as a valid **project-tier** style.
2. WHEN it appears THEN its displayed name SHALL be `Simplified Technical English`, **not** `simplified-technical-english` — proving the name-vs-filename binding is handled.
3. WHEN it is activated THEN the value written to `outputStyle` SHALL be `Simplified Technical English`.
4. WHEN it is inspected THEN `keep-coding-instructions` SHALL read as ON.

---

## Edge Cases That Must Be Specified

| #   | Case                                                 | Required behaviour                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | **`name` ≠ filename**                                | The settings value binds to the frontmatter `name`. All read, write, activate, and compare logic keys on `name`; the filename is presentation/storage only. Never write a filename to `outputStyle`.                                                                                                                                       |
| E2  | **Which settings tier Ptah writes**                  | Must be an explicit, stated decision — user (`~/.claude/settings.json`), project (`<project>/.claude/settings.json`, committable), or local (`.claude/settings.local.json`, gitignored). The UI must show the user which file was changed. Ptah has never written any of these files before; the write must be merge-preserving (Req 2.2). |
| E3  | **Localhost-proxy provider**                         | `'user'` is dropped from `settingSources`; `'project'` and `'local'` survive. A project-tier style still works normally. Only a **user-tier** style needs the `sessionConfig.systemPrompt` fallback (Req 5).                                                                                                                               |
| E4  | **Duplicate `name` across tiers**                    | Two styles with the same `name` in different tiers are ambiguous under a name-keyed settings value. The list must show both with their tier badges and flag the collision; the resolution order applied by Ptah must match the SDK's merge order, and the UI must warn on save if a create/edit introduces a new collision.                |
| E5  | **Active style whose file was deleted outside Ptah** | `outputStyle` points at a name that no longer resolves. The UI must show the active selection as **missing**, name the value, and offer one-click "revert to default" (which clears the key) or "recreate". It must not present a phantom style as active and healthy.                                                                     |
| E6  | **Plugin `outputStyles` key override**               | When a plugin's `plugin.json` sets `outputStyles`, the plugin's `output-styles/` folder is **not** auto-loaded. Discovery must follow that rule rather than blind-scanning plugin directories.                                                                                                                                             |
| E7  | **`force-for-plugin` on a user style**               | Valid schema key, but meaningless outside plugins — the CLI warns and ignores it. The Ptah create/edit form must not expose it for user- or project-tier styles.                                                                                                                                                                           |
| E8  | **Concurrent edit**                                  | The user may edit the same file in their editor while the Ptah sub-view is open. Save must not silently discard external changes without at least detecting a modified-since-load state.                                                                                                                                                   |

---

## Out of Scope

Stated explicitly so the architect does not design for them:

- **Authoring plugin-bundled styles.** Read/display only; plugin styles are never editable or deletable from Ptah.
- **A marketplace, gallery, or share/import mechanism for styles.** No remote catalogue, no publish flow, no community list.
- **Live preview of a style's effect on a real model response.** No test-drive button, no sample generation, no round-trip to a provider.
- **Any change to `PTAH_CORE_SYSTEM_PROMPT`** or to the `assembleSystemPrompt` ordering/precedence beyond wiring the fallback injection input.
- **Changing the existing `settingSources` localhost branch.** It is treated as fixed behaviour to design around, not to modify.
- **A `thoth-shell` tab or any new frontend lib.** Settled: the surface extends `libs/frontend/chat/src/lib/settings/settings.component.ts`.
- **Migrating Ptah's own `~/.ptah/settings.json` store** to carry output-style state.

---

## Non-Functional Requirements

### Architecture and boundaries

- Backend file I/O SHALL go through `platform-core` `IFileSystemProvider` ports. Direct `node:fs` is forbidden — the service must run identically under the VS Code, Electron, and CLI adapter families.
- Output-style logic SHALL live in its own concern, not be appended to the `agent-sdk` barrel. `agent-sdk` consumes the resolved style; it does not own discovery, parsing, or CRUD.
- Frontend libs SHALL NOT import backend libs. Types cross via `libs/shared` only.

### RPC

- A new RPC namespace SHALL be registered in **both** places or it will crash silently at runtime: compile-time types in `libs/shared/.../rpc.types.ts` **and** the prefix in `ALLOWED_METHOD_PREFIXES` at `libs/backend/vscode-core/src/messaging/rpc-handler.ts:46`.

### Validation and security

- All RPC payloads and all parsed frontmatter SHALL be validated with Zod at the boundary. Frontmatter parsing must mirror the SDK's strictness so Ptah's verdict on a file matches the SDK's.
- Style names SHALL be sanitised before use in any filesystem path — no separators, no `..`, no reserved Windows device names, length-bounded.
- Style markdown SHALL NEVER be rendered with `[innerHTML]`. Preview goes through `libs/frontend/markdown` (the single DOMPurify chokepoint). A style body is user-authored content that may contain arbitrary HTML.
- Error messages surfaced to the UI SHALL be formatted diagnostics, not raw exception text or absolute host paths.

### Frontend

- Angular 21, signals, `inject()`, `ChangeDetectionStrategy.OnPush` mandatory.
- The surface SHALL work identically in the VS Code webview and the Electron app — no runtime-conditional feature gating of the picker itself.

### Marketplace (BLOCKING)

- The shipped VSIX SHALL NOT gain any **non-JS** file containing trademarked AI product names (`claude`, `copilot`, `codex`, `openai`, `anthropic`). Any starter/template style content must be embedded in JS or downloaded at runtime via `ContentDownloadService` — never added as a VSIX markdown asset. A burned extension ID is permanent.

### Performance

- Discovery of all tiers SHALL complete in under 300 ms on a warm filesystem for up to 50 style files, and SHALL NOT block the settings panel's initial render.

---

## Risks

| #      | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Prob.  | Impact   | Mitigation                                                                                                                                                                                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1** | **Partial compliance is the ceiling.** `assembleSystemPrompt` always appends `PTAH_CORE_SYSTEM_PROMPT` on top of the `claude_code` preset (`sdk-query-options-builder.ts:216`), and that prompt carries its own formatting, tone, and behaviour rules. It is the longer and stronger voice. A style with `keep-coding-instructions: true` is **additive**, and a writing-style output style will therefore produce **partial, not total, compliance**. | High   | High     | **The product must not promise total compliance.** UI copy describes a style as _influencing_ how the agent writes, not as governing it. No claim of guaranteed adherence. This is a copy and expectations requirement, not an engineering one — do not attempt to weaken `PTAH_CORE_SYSTEM_PROMPT` to raise compliance (out of scope). |
| R2     | **Ptah begins writing `.claude/settings.json`, a file it has never touched.** That file is co-owned by the user and the Claude Code CLI and may be committed to the repo. A clobbering write destroys unrelated user configuration.                                                                                                                                                                                                                    | Medium | Critical | Merge-preserving read-modify-write (Req 2.2), explicit tier disclosure in the UI, and a test that proves unrelated keys survive.                                                                                                                                                                                                        |
| R3     | **Double application** of the style — active via settings _and_ injected via `sessionConfig.systemPrompt` — producing a duplicated, self-contradicting prompt.                                                                                                                                                                                                                                                                                         | Medium | High     | Req 5.3: the two paths must be mutually exclusive by construction, resolved once per session from tier + provider base URL. Requires an explicit unit test asserting single occurrence.                                                                                                                                                 |
| R4     | **Silent schema drift.** The `.strict()` frontmatter schema lives in a vendored binary. An SDK upgrade adding a fifth key would make Ptah's validator reject files the SDK accepts (or vice versa).                                                                                                                                                                                                                                                    | Low    | Medium   | Keep the Zod schema in one named location with a comment pinning it to SDK v0.3.150 and the source of truth; treat mismatch as a known upgrade checkpoint.                                                                                                                                                                              |
| R5     | **Users disable coding instructions by accident** via `keep-coding-instructions`, degrading agent quality and blaming Ptah.                                                                                                                                                                                                                                                                                                                            | Medium | High     | Req 6: default ON, plain-language labelling, explicit warning on OFF.                                                                                                                                                                                                                                                                   |
| R6     | **Tier confusion.** User picks project tier, commits `.claude/settings.json`, and changes their whole team's agent voice without intending to.                                                                                                                                                                                                                                                                                                         | Medium | Medium   | Req 3.3 one-sentence tier explanation; Req 2 UI must name the exact file written.                                                                                                                                                                                                                                                       |

---

## Stakeholder Impact

| Stakeholder             | Impact      | Involvement            | Success criterion                                                                            |
| ----------------------- | ----------- | ---------------------- | -------------------------------------------------------------------------------------------- |
| End users (Ptah chat)   | High        | Selection + authoring  | Can discover, choose, and author a style without reading any docs or opening a file manually |
| Power users / CLI users | Medium      | Cross-tool consistency | A style chosen in Ptah applies when they run `claude` directly on the same project           |
| Teams                   | Medium      | Project-tier styles    | Can commit a shared project style and have every member's Ptah pick it up                    |
| Ptah maintainers        | Medium      | Implementation         | New concern isolated in its own lib; `agent-sdk` unchanged except the fallback input         |
| Marketplace review      | High (gate) | Release                | VSIX gains no trademark-bearing non-JS file                                                  |

---

## Quality Gates (requirements-level)

- [x] Every requirement is testable and stated as observable behaviour
- [x] Acceptance criteria in WHEN/THEN/SHALL form
- [x] Every edge case in `context.md` is covered (E1–E5) plus three derived (E6–E8)
- [x] Out of scope stated explicitly
- [x] Marketplace, RPC dual-registration, OnPush, `[innerHTML]`, and `IFileSystemProvider` constraints carried into NFRs
- [x] R1 (partial compliance) named plainly with a product promise attached
- [x] No implementation design — activation _mechanism_ is stated as constraint, not as architecture

---

## Handoff to Architect

Open design questions this document deliberately does **not** answer:

1. Which settings tier Ptah writes by default, and whether the tier is user-selectable (E2).
2. Where the new backend lib/concern lives and how `agent-sdk` receives the fallback style body without owning discovery.
3. The exact mechanism guaranteeing mutual exclusion of the two activation paths (Req 5.3).
4. The RPC namespace name and method surface.
5. How the settings panel hosts the picker and the create/edit sub-view — which tab, and navigation between list and editor.

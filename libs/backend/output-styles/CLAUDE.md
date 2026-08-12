# @ptah-extension/output-styles

[Back to Main](../../../CLAUDE.md)

## Purpose

Owns the agent CLI's **output-style** surface inside Ptah (TASK_2026_197): tier discovery of `.md` style files, the strict frontmatter contract, safe create/edit/delete of those files, and the **single decision** about how a chosen style actually reaches a session — plus the one composition that applies that decision at a session start. Five injectable services plus four pure modules; the pure modules do no I/O and the services do all of theirs through `IFileSystemProvider` or `ISettingsStore`.

An output style is a markdown file with at most four frontmatter keys and a body. The body becomes the agent's style prompt. Styles live in three places Ptah cares about: four **built-ins** baked into the SDK binary, `~/.claude/output-styles/*.md` (**user** tier) and `<workspaceRoot>/.claude/output-styles/*.md` (**project** tier).

### Activation model — read this before changing anything

There are **two** ways a style reaches a session, and they are complements of one boolean. `resolveActivation` in `output-style-activation.resolver.ts` is the only place that chooses.

1. **Flag tier — the primary mechanism, used for almost everything.** The style `name` rides `Options.settings.outputStyle`, assembled by `buildFlagSettings` in `agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` and carried on `AISessionConfig.outputStyleName`. The binary enables this tier **unconditionally** and it **outranks** the user/project/local settings files. It involves no I/O, so it cannot fail.
2. **Prompt injection — a narrow fallback.** The style _body_ rides `AISessionConfig.outputStyleBody` and is appended exactly once in `assembleSystemPrompt`. It is reachable **only** for a **user-tier style _file_ on a localhost-proxy provider**, because the CLI gates its style-file directory scan on the `userSettings` settings source, and those sessions drop `'user'` from `settingSources`. Built-in, project- and plugin-tier styles are always file-visible, so they never inject on any provider.

`inject` is defined as `!fileVisible`, so the two paths **cannot both apply**. `assertSingleOutputStylePath` (agent-sdk) throws at session start if both `AISessionConfig` fields are ever set together — that is a regression detector, not a code path.

**The `outputStyle` key must be ABSENT when no style is selected.** Not `undefined`, not `'default'`. Because the flag tier outranks the user's own `~/.claude/settings.json`, emitting the key when Ptah has no opinion would silently clobber a style the user chose for their own CLI sessions. `buildFlagSettings` returns the shared constant unchanged in that case, and a spec asserts `'outputStyle' in settings === false`.

**CLI parity is not activation.** `ClaudeSettingsWriter` writes `outputStyle` into a `.claude/settings*.json` file. That file plays no part in how a style activates inside Ptah — it exists **only** so a style chosen in Ptah also applies when the user runs the CLI directly. It is **opt-in and default OFF**, and a failure there is reported beside a selection that has already succeeded; it never rolls one back.

## Boundaries

**Belongs here**:

- The frontmatter schema, its version pin, parse and serialize (`output-style-frontmatter{,.schema}.ts`)
- Slug safety — user text → filename, treated as a security boundary (`output-style-slug.ts`)
- The four built-ins the binary ships (`built-in-output-styles.ts`)
- Tier discovery, SDK merge order, shadow flagging, invalid-file listing (`output-style-discovery.service.ts`)
- Style-file upsert / delete / stat, including the concurrent-edit guard (`output-style-file.writer.ts`)
- The merge-preserving, opt-in CLI-parity settings write (`claude-settings.writer.ts`)
- The one activation decision (`output-style-activation.resolver.ts`)
- The one read/write/normalisation of the persisted selection (`output-style-selection.ts`)
- The one composition of selection + discovery + decision into the two `AISessionConfig` fields (`output-style-session-activation.service.ts`)

**Does NOT belong**:

- The RPC surface — `OutputStyleRpcHandlers` and its Zod param schemas live in `rpc-handlers`
- Deciding WHEN a session starts, or what else rides its config — `chat-session.service.ts` (`rpc-handlers`) and `ptah-cli-spawn-options.service.ts` (`cli-agent-runtime`) call `resolveSessionFields` and spread the result
- The flag-tier spread itself — `buildFlagSettings` / `assembleSystemPrompt` live in `agent-sdk`
- Persisting the user's choice — that is `settings-core`'s `outputStyle.selectedName` (`~/.ptah/settings.json`, `''` = none). This lib READS it through `output-style-selection.ts`; the schema and store stay in `settings-core`
- Frontend rendering — `libs/frontend/chat/src/lib/settings/output-style/`
- Platform adapters, and any dependency on `agent-sdk`
- Plugin-tier enumeration — deferred, see below

## Public API

Frontmatter contract: `SDK_OUTPUT_STYLE_VERSION_PIN`, `OUTPUT_STYLE_FRONTMATTER_KEYS`, `OutputStyleFrontmatterSchema`, `OutputStyleFrontmatter`.
Pure parse/serialize: `parseOutputStyleFile`, `serializeOutputStyleFile`, `normalizeFrontmatterKeys`, `deriveDescription`, `toValidationError`, `EMPTY_DESCRIPTION_FALLBACK`, `ParsedOutputStyle`, `ParseOutputStyleResult`, `SerializeOutputStyleInput`.
Slug: `slugifyStyleName`, `styleFileName`, `MAX_SLUG_LENGTH`, `SlugifyStyleNameResult`.
Built-ins: `BUILT_IN_OUTPUT_STYLES`, `DEFAULT_OUTPUT_STYLE_NAME`, `isBuiltInOutputStyleName`.
Discovery + shared path helpers: `OutputStyleDiscoveryService`, `OUTPUT_STYLES_DIR_SEGMENTS`, `FILE_OUTPUT_STYLE_TIERS`, `resolveHomeDirectory`, `userOutputStyleDirectory`, `projectOutputStyleDirectory`, `outputStyleDirectoryFor`, `toDisplayPath`, `FileOutputStyleTier`, `DiscoverOutputStylesOptions`, `OutputStyleDiscoveryResult`.
File writer: `OutputStyleFileWriter` (+ `OutputStyleFileLocation`, `OutputStyleGuardStamp`, `OutputStyleFileTarget`, `SaveOutputStyleParams`/`Result`, `DeleteOutputStyleParams`/`Result`, `StatOutputStyleParams`/`Result`).
Parity writer: `ClaudeSettingsWriter`, `SetOutputStyleParityParams`.
Activation: `resolveActivation`, `OutputStyleActivationResolver`, `ResolveActivationInput`.
Selection: `normalizeOutputStyleSelection`, `readOutputStyleSelection`, `writeOutputStyleSelection`, `resolveProviderBaseUrl`, `OutputStyleSelectionContext`.
Session activation: `OutputStyleSessionActivationService`, `OutputStyleSessionFields`, `ResolveSessionFieldsOptions`.
DI: `OUTPUT_STYLE_TOKENS`, `OutputStyleDIToken`, `registerOutputStyleServices`.

Wire types (`OutputStyleEntry`, `ActivationDecision`, `InvalidOutputStyle`, `ActiveOutputStyleState`, `OutputStyleOperationError`, `OutputStyleValidationError`, `OutputStyleParityOutcome`, `SettingsTier`, `WritableOutputStyleTier`) live in `@ptah-extension/shared`, not here.

## Internal Structure

- `src/lib/output-style-frontmatter.schema.ts` — the strict four-key Zod schema and the SDK version pin. **Single named location.**
- `src/lib/output-style-frontmatter.ts` — pure `parseOutputStyleFile` / `serializeOutputStyleFile`, camelCase→kebab folding, derived description, typed-error mapping
- `src/lib/sanitize-diagnostic.ts` — the **one** Req 7.6 path-stripping pipeline, shared by the frontmatter parser and the parity writer; the truncation cap is the only parameter
- `src/lib/output-style-slug.ts` — two-pass name → `.md` basename; rejects traversal, colons, control characters and Windows device names
- `src/lib/built-in-output-styles.ts` — the four names the binary owns, verbatim casing, `body: undefined`
- `src/lib/output-style-discovery.service.ts` — tier scan in SDK merge order, shadow flags, invalid rows, active-style resolution; also owns every path helper the writers share
- `src/lib/output-style-file.writer.ts` — upsert / delete / stat of user- and project-tier files
- `src/lib/claude-settings.writer.ts` — read-modify-write of `.claude/settings*.json` for opt-in CLI parity
- `src/lib/output-style-activation.resolver.ts` — `resolveActivation` + its injectable wrapper
- `src/lib/output-style-selection.ts` — the one read/write/normalisation of `outputStyle.selectedName`, shared by `OutputStyleRpcHandlers` (what is active) and `OutputStyleSessionActivationService` (what to activate). Two implementations means the picker can show one style while another reaches the SDK — do not re-inline either half
- `src/lib/output-style-session-activation.service.ts` — the one composition: selection → tier scan → decision → the two `AISessionConfig` fields
- `src/lib/di/{tokens,register}.ts` — `OUTPUT_STYLE_TOKENS`, `registerOutputStyleServices`
- `src/lib/__fixtures__/output-style.fixtures.ts` — fixtures as **inline TS string constants**, deliberately not `.md` files

## Key Files

- `src/lib/output-style-activation.resolver.ts` — the flag-vs-inject decision. Takes `userSettingSourceIncluded` as a FACT from the caller; it does not infer visibility from a base URL
- `src/lib/output-style-frontmatter.schema.ts` — pinned to **SDK v0.3.150**; the R4 upgrade checkpoint lives in its header
- `src/lib/claude-settings.writer.ts` — the only place Ptah writes a **co-owned** foreign settings file
- `src/lib/output-style-slug.ts` — the path-traversal boundary
- `src/lib/built-in-output-styles.ts` — the marketplace-sanctioned home for product-name text (see Guidelines)

## Dependencies

**Internal**: `@ptah-extension/shared` (wire types), `@ptah-extension/platform-core` (`IFileSystemProvider`, `IWorkspaceProvider`, `PLATFORM_TOKENS`), `@ptah-extension/vscode-core` (`Logger`, `TOKENS`), `@ptah-extension/settings-core` (`ISettingsStore`, `WorkspaceScopeResolver`, `OUTPUT_STYLE_SELECTED_NAME_DEF` — the persisted selection), `@ptah-extension/auth-providers-tokens` (`SDK_AUTH_ENV`, zero-dep by design; never the full `auth-providers` barrel).
**External**: `gray-matter`, `zod`, `tsyringe`.
**Forbidden**: `agent-sdk` (would invert the lib graph — `rpc-handlers` composes the two instead), any `platform-{cli,electron,vscode}` adapter, any frontend lib, `node:fs`.

## Guidelines

- **The schema is strict, and a fifth key voids the file silently in the CLI.** That is the whole reason this lib exists. Exactly four keys are accepted: `name`, `description`, `keep-coding-instructions`, `force-for-plugin`. An unrecognised key yields `UNRECOGNIZED_KEY` **naming the offending key** and listing all four valid ones — never a generic "invalid file". Keep the key list in `OUTPUT_STYLE_FRONTMATTER_KEYS`; do not spell it a second time anywhere.
- **R4 upgrade checkpoint.** `SDK_OUTPUT_STYLE_VERSION_PIN = '0.3.150'`. When the agent SDK's minor version moves, re-verify the schema against the binary before bumping the pin. Drift means Ptah rejects files the SDK accepts, or accepts files it rejects — which breaks the only guarantee this surface owes the user.
- **Reads accept camelCase, writes are always kebab-case.** The SDK loads frontmatter with `normalizeKeys: true`, so `keepCodingInstructions` must parse identically. `normalizeFrontmatterKeys` folds before `.strict()` runs; when both spellings appear, kebab wins.
- **`keep-coding-instructions` absent and `false` mean the same thing** (the style replaces the coding instructions), matching the binary's assembly.
- **Identity is the frontmatter `name`, never the filename.** The slug decides only where a _new_ file is stored. An edit **locates** its file by parsing the tier directory, so a hand-authored `foo.md` holding `name: Bar` is edited in place instead of being orphaned beside a fresh `bar.md`.
- **`default` is a sentinel, not a style.** Selecting it means "no style", which is the key-removal branch on the parity write.
- **Every `matter()` call must pass `MATTER_OPTIONS`.** gray-matter takes a module-global cache branch only when no options object is given, and that cache stores the file object _before_ parsing — so the same malformed bytes are diagnosed differently on the second call in a process. Same defect documented in `task-specs/src/lib/task-frontmatter.ts`.
- **Nothing throws past its boundary.** Every failure is a typed `OutputStyleValidationError` / `OutputStyleOperationError` with a display-ready message. **No absolute host path and no raw exception text ever reaches a returned message** — paths are `~`- or workspace-relative via `toDisplayPath`, and foreign diagnostics go through the sanitisers before being quoted.
- **A missing `output-styles` directory is a normal state**, not an error. Invalid files are **listed**, never omitted — a style that vanished because of a typo is the failure mode this surface exists to fix.
- **The parity write treats `.claude/settings*.json` as co-owned.** Malformed pre-existing JSON **aborts without ever calling `writeFile`** — a deliberate divergence from `PtahFileSettingsManager.loadSync`, which resets a corrupt file to `{}` (correct for a file Ptah owns, destructive here). The merge is a spread so unrelated keys and their order survive; a `.ptah-bak` copy is written before and removed after, because `IFileSystemProvider` has no `rename` and a real tmp+rename atomic write is not expressible through the port; a pre-write re-read that differs aborts as `SETTINGS_CONFLICT`. That narrows the loss window, it does not close it.
- `catch (error: unknown)`, narrow with `instanceof Error`. All I/O through `IFileSystemProvider`; `node:path` is pure string computation and needs no port.

### The two wiring guards — do not relax them to make CI green

This lib cannot import `agent-sdk` (that would invert the lib graph), so two specs
assert the SDK builder still _uses_ what this lib assumes, by **reading the builder's
source**. Both are USE checks, not duplication checks — the duplication they used to
police is gone:

1. **Predicate use** — `output-style-activation.resolver.spec.ts` asserts the builder
   still derives `settingSources` from `includesUserSettingSource` (`shared`), and that
   it carries no localhost regex of its own. That function is the ONE definition:
   `agent-sdk` calls it to BUILD `settingSources`, this lib's callers call it to PREDICT
   the same value. There used to be two regex literals here kept in step by comparing
   source text; the resolver now takes `userSettingSourceIncluded` as a fact from the
   caller and knows nothing about URLs.
2. **Flag-tier use** — `agent-sdk/src/lib/helpers/sdk-query-options-builder.output-style.spec.ts`
   asserts `build()` contains `settings: buildFlagSettings(sessionConfig)` and **not**
   the bare shared constant, and that the inject body is forwarded into
   `assembleSystemPrompt`. A correct helper is worthless if the builder still hands the
   SDK the bare constant, and a unit test of the helper cannot see that.

Both fail CI if the builder changes without this lib changing. That is the point.

### Marketplace constraint (BLOCKING)

The extension scanner rejects **non-JS** files containing trademarked AI product names. Built-in style descriptions may reference such names **only** because `built-in-output-styles.ts` is a `.ts` file compiled into `main.mjs`, and JS bundles are explicitly safe.

- **Never add a `.md` template, starter or fixture asset to this lib.** Test fixtures are inline TS string constants for exactly this reason. If starter styles are ever wanted, they are TS constants or a runtime download through `ContentDownloadService`.
- The reference style at the repo root's `.claude/output-styles/` is working-tree content discovered at runtime — it is not packaged, copied or moved by this lib.
- Keep this document's own prose free of those names too, as belt-and-braces.

### Deferred and known gaps

- **Plugin tier (P5) is DEFERRED and needs an architect pass before anyone builds it.** The `'plugin'` tier is modelled in `OutputStyleEntry` and handled by the activation predicate and the list renderer, so the types stay total — but **nothing enumerates it**, and there is deliberately no `plugin-roots.port.ts`, no `IPluginRootsSource` and no plugin token. The scope was rewritten after the architecture was approved; read the **"G6 Resolution — P5 Scope Rewrite"** note in `.ptah/specs/TASK_2026_197/context.md` before touching it. Short version: it is _not_ a free ride on `SkillJunctionService` — skills are directories and junctions are directory-only, whereas styles are individual files, so it needs file-level materialization with provenance tracking and stale cleanup. A `${plugin}:${style}` value must never be written into any settings file.
- **An invalid file's body cannot round-trip through the editor.** The "open to fix" path can show the diagnostic, but restoring the original body needs a backend raw-read method that does not exist yet — discovery only returns parsed styles. Recorded as Batch 6 deviation 1 of TASK_2026_197.
- The `mtime` half of the concurrent-edit guard is advisory: the shared filesystem contract suite guarantees only `type` and `size` on `stat`, so byte length is the authoritative half and `mtime` is compared only when an adapter actually supplied one.

## Cross-Lib Rules

Consumed by **two** libs that cannot see each other — `rpc-handlers → cli-agent-runtime`, so anything both need lives here:

- `rpc-handlers` (`rpc-handlers → output-styles`, acyclic) — the `outputStyle:` RPC namespace, and `ChatSessionService`, which calls `resolveSessionFields({ workspaceRoot })` at session start and resume.
- `cli-agent-runtime` (`cli-agent-runtime → output-styles`, acyclic) — `PtahCliSpawnOptions`, which calls `resolveSessionFields({ workspaceRoot, userSettingSourceIncluded: true })` for every agent spawned through `ptah_agent_spawn`, including the tribunal's `ptah-cli` lanes. **`userSettingSourceIncluded: true` is mandatory on that path**: `PtahCliRegistry` hardcodes `settingSources: ['user', 'project', 'local']`, so a user-tier style file is never invisible there and deriving the answer would take the inject branch and apply the style twice (R3).

`rpc-handlers` owns the `outputStyle:` RPC namespace — `list`, `get`, `activate`, `save`, `delete`, `diagnose`. That namespace is triple-registered: `libs/shared/.../rpc.types.ts`, the `ALLOWED_METHOD_PREFIXES` runtime guard in `vscode-core/src/messaging/rpc-handler.ts`, and the handler manifest. Missing any one of them fails either CI or the call at runtime.

`registerOutputStyleServices(container, logger)` must be called in **all three** composition roots, because `OutputStyleRpcHandlers` is a `requires: []` manifest entry fanned to every host: `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, `apps/ptah-electron/src/di/phase-2-libraries.ts`, and `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts`. Pre-conditions: `TOKENS.LOGGER`, `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`, `PLATFORM_TOKENS.WORKSPACE_PROVIDER` and `SETTINGS_TOKENS.SETTINGS_STORE` are registered. Injection is lazy, so relative call order does not matter — only that all of them ran before the first resolve.

It is now also a **chat** pre-condition, not just an RPC one: `ChatSessionService` injects `SESSION_ACTIVATION` non-optionally. `registerChatServices` no longer registers a chat-local copy. A host that registers chat services without this one fails at the first session start, not at bootstrap.

Imports `platform-core` / `vscode-core` / `shared` only. Frontend libs MUST NOT import this.

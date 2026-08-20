# Implementation Plan — TASK_2026_197

**Feature**: Output-style surface — discover, choose, create, and edit Claude Code output styles inside Ptah
**Ground truth**: `./context.md` (SDK mechanism, verified — not re-derived here)
**Requirements**: `./task-description.md` (8 requirements, 8 edge cases, 6 risks — all mapped below)

---

## 0. Concurrency Contract (read before touching anything)

Other agents hold uncommitted work in this tree. This plan is built to avoid every known hotspot.

**No file in this plan is rewritten wholesale.** Every touched file is marked **CREATE** (this task authors it from nothing → `Write` is legal) or **EDIT** (surgical `Edit` only, after a fresh `Read`).

**Frontend blast radius is confined to `libs/frontend/chat/src/lib/settings/`.** In-flight `app-shell.component.{ts,html}` is **not touched**. This is achieved by a deliberate design choice: the surface is a **section inside the existing "Advanced" tab**, not a new tab. A new tab would have forced an edit to `SettingsTabId` in `libs/frontend/core/src/lib/services/app-state.service.ts:62-66` — and `libs/frontend/core` has in-flight work (`lazy-view.service.ts`, `index.ts`, `services/index.ts`, `lazy-view-components.token.ts`). **`libs/frontend/core` is not touched by this plan at all.**

Three shared-file edits are unavoidable and are flagged as coordination points: `tsconfig.base.json` (1 line), `rpc.types.ts` (4 blocks), `rpc-handler.ts` (1 line).

---

## 1. Architecture Overview

### Data flow

```
                       ~/.claude/output-styles/*.md          (user tier)
                       <ws>/.claude/output-styles/*.md       (project tier)
                       <pluginRoot>/output-styles/*.md       (plugin tier, Phase 5)
                       BUILT_IN_OUTPUT_STYLES (TS const)     (built-in tier)
                                    |
                                    | IFileSystemProvider.readDirectory / readFile
                                    v
              +-----------------------------------------------+
              | libs/backend/output-styles   (NEW LIB)        |
              |                                               |
              |  OutputStyleDiscoveryService  -- list/parse   |
              |  OutputStyleFileWriter        -- create/edit/delete
              |  ClaudeSettingsWriter         -- merge-preserving RMW of
              |                                  .claude/settings*.json
              |  OutputStyleActivationResolver-- ONE decision point (R3)
              +-----------------------------------------------+
                                    |
                                    | tsyringe (OUTPUT_STYLE_TOKENS)
                                    v
              OutputStyleRpcHandlers  (libs/backend/rpc-handlers)
                                    |
                                    | 'outputStyle:*'  — dual-registered
                                    v
              ClaudeRpcService.call()   (libs/frontend/core — READ-ONLY, not edited)
                                    |
                                    v
              OutputStyleStore  (signals)   libs/frontend/chat/src/lib/settings/output-style/
                                    |
                    +---------------+----------------+
                    v                                v
        OutputStyleListComponent          OutputStyleEditorComponent
        (tier badges, active marker,      (form + MarkdownBlockComponent preview)
         invalid entries, activate)
                    \                                /
                     +--- OutputStyleConfigComponent ---+   <ptah-output-style-config />
                                    |
                                    v
             settings.component.html — "Advanced" tab (@if pro-features)
```

### Activation flow (the second, independent path)

> **Revised (rev 2):** activation moved to the **flag settings tier** (`Options.settings`), which `km()` always enables regardless of `settingSources`. The _key_ half of the tier problem is retired. The _file_ half survives — `HU` gates directory scanning on `i3('userSettings')` — so the injection fallback narrows to exactly one axis: a **user-tier style file** on a localhost provider.

```
chat:start / chat:continue
  chat-session.service.ts  (providerProfile.baseUrl ALREADY resolved here, :425-429 / :954-958)
        |
        | OutputStyleActivationResolver.resolveForSession({ baseUrl, activeStyle })
        v
   ActivationDecision  =  { path: 'none' }            <- nothing active
                       |  { path: 'flag', styleName } <- key rides Options.settings (flag tier)
                       |  { path: 'inject', body }    <- style FILE is invisible; Ptah appends body
        |
        +-- if 'flag':   settings = { ...PTAH_DISABLE_SDK_AUTO_MEMORY, outputStyle: styleName }
        |                 (fresh spread per session — the shared constant is never mutated)
        |
        +-- if 'inject': AISessionConfig.outputStyleBody = body
                          -> assembleSystemPrompt -> appendParts.push(body)
```

Separately and optionally, **CLI parity**: `ClaudeSettingsWriter` mirrors the choice into `.claude/settings.json` so a style chosen in Ptah also applies when the user runs `claude` directly. That is a _convenience write_, no longer the activation mechanism (§4).

---

## 2. Decision 1 — Backend Lib Placement

### Decision: a new focused lib, `libs/backend/output-styles` (`@ptah-extension/output-styles`)

**Not `agent-sdk`.** Forbidden by project instructions ("do NOT replicate the agent-sdk monolith") and by NFR ("`agent-sdk` consumes the resolved style; it does not own discovery, parsing, or CRUD"). `agent-sdk`'s `SDK_TOKENS` already carries ~60 tokens across 10 concerns.

**Not `settings-core`.** Evidence-based rejection:

|              | `settings-core` owns                                                                                            | this feature owns                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| File         | `~/.ptah/settings.json` (+ `secrets.enc.json`)                                                                  | `.claude/settings*.json` and `.claude/output-styles/*.md`                  |
| Owner        | Ptah, exclusively                                                                                               | **co-owned with the Claude Code CLI and the user**, possibly git-committed |
| Schema       | `defineSetting()` + `SETTINGS_SCHEMA` + a 4-step migration runner (`src/migrations/runner.ts`)                  | a foreign, vendored, `.strict()` frontmatter schema pinned to SDK v0.3.150 |
| Write model  | in-process promise chain + tmp/rename, corrupt file silently reset to `{}` (`file-settings-manager.ts:460-476`) | corrupt file must **abort**, never reset — it is not ours to discard       |
| Reads FS via | raw `node:fs` (`secrets-file-store.ts:11-13`)                                                                   | `IFileSystemProvider` (NFR, must run under all 3 adapter families)         |

Folding this into `settings-core` would give that lib a second file ownership with opposite corruption semantics and an opposite I/O policy. That is two concerns, not one. **New lib.**

**Scope of the new lib** — one concern, stated as a sentence: _own the on-disk representation of Claude Code output styles and decide how an active style reaches a session._ Four services, no more.

**Zero dependency on `agent-sdk`.** Plugin-root enumeration (Phase 5) crosses that boundary via a narrow port declared **in this lib** (`IPluginRootsSource`), with the `PluginLoaderService`-backed adapter registered in the composition roots. Precedent: `TASK_INDEX_NOTIFIER_TOKEN` in `libs/backend/task-specs/src/lib/task-index.port.ts:9-11` (the lib declares the port, the root wires the seam).

**Dependencies**: `@ptah-extension/platform-core` (ports + tokens), `@ptah-extension/shared` (contract types), `gray-matter`, `zod`. Nothing else.

---

## 3. Decision 2 — The Double-Application Problem (R3, Req 5.3)

> **Revised (rev 2):** the key half is retired by the flag tier (G1, verified). The file half is confirmed real (G2, verified — file discovery _does_ honour `settingSources`). The predicate collapses from two axes to one: `inject === !fileVisible`. The `'inert'` branch is deleted as unreachable (G5, verified).

This is the highest-risk part of the design. It is solved by making the two paths **complements of a single boolean**, evaluated once, in one function.

### 3.1 The two halves, and which one the flag tier retires

Two _independent_ things must be visible to the SDK for the SDK to apply a style itself:

1. the **`outputStyle` key**, and
2. the **style file**.

**Half 1 is now solved and no longer varies.** `Options.settings` loads an inline `Settings` object into the flag tier (`sdk.d.ts:1709-1726`), and the binary's source gate always enables it:

```js
function km(){ let H=wK8(); ... let q=new Set(H); q.add("flagSettings"); q.add("policySettings"); return BW.filter(($)=>q.has($)); }
function i3(H){ return km().includes(H) }
```

`wK8()` returns `allowedSettingSources` (the `settingSources` option), but `flagSettings` is **unconditionally added** to the set. `outputStyle` is a member of `Settings` (`sdk.d.ts:5037`), and `BW=["userSettings","projectSettings","localSettings","flagSettings","policySettings"]` is the low→high precedence order — so a flag-tier `outputStyle` is always merged **and outranks user/project/local**. Ptah already puts an object on this exact wire: `settings: PTAH_DISABLE_SDK_AUTO_MEMORY` at `sdk-query-options-builder.ts:600`.

**Half 2 still varies, and this is the determining finding.** The style-file loader `HU` gates each directory scan on the _same_ source list:

```js
HU=v6(async function(H,q){ let $=Lu.join(c6(),H), _=Lu.join(eX(),".claude",H), f=O08(H,q); ...
  let[Y,O,M]=await Promise.all([
    sQq(_).then(...source:"policySettings"),
    i3("userSettings")    ? sQq($).then(...source:"userSettings")    : Promise.resolve([]),
    i3("projectSettings") ? Promise.all(f.map(...source:"projectSettings")) : Promise.resolve([]),
  ]); ... })
```

So when `settingSources` omits `'user'`, `~/.claude/output-styles/` is **not scanned at all**. A user-tier style file simply does not exist from that session's point of view, no matter how the key is delivered.

**Consequence**: the fallback survives, but only for the file half, and on exactly one axis — _user-tier style file × localhost provider_. `keyVisible` is permanently true and is deleted from the predicate.

### 3.2 The single predicate

`libs/backend/output-styles/src/lib/output-style-activation.resolver.ts` — one exported pure function plus one thin service around it:

```ts
/**
 * The ONLY place that decides how an output style reaches a session.
 * `inject` is defined as `!fileVisible`, so the two paths are complements of
 * one boolean and CANNOT both be true. R3 / Req 5.3.
 *
 * The `outputStyle` KEY always rides the flag tier (Options.settings), which
 * the binary's km() enables unconditionally — so key visibility is not an
 * input here. Only FILE visibility varies, because HU gates directory scans
 * on i3('userSettings') / i3('projectSettings').
 *
 * Mirrors sdk-query-options-builder.ts:625-629 exactly. If that predicate
 * changes, this must change with it — see the guard spec.
 */
export const LOCALHOST_BASE_URL_RE = /^https?:\/\/(127\.0\.0\.1|localhost)/i;

export function resolveActivation(input: {
  readonly style: OutputStyleEntry | null; // already name-resolved winner, or null
  readonly providerBaseUrl: string | undefined;
}): ActivationDecision {
  if (!input.style) return { path: 'none' };

  // Built-ins live in the binary's CwH map, keyed by name, independent of any
  // directory scan — always resolvable. Plugin styles load through the plugin
  // mechanism, not through HU's settingSources-gated scan.
  const fileVisible =
    input.style.tier === 'builtin' ||
    input.style.tier === 'plugin' ||
    input.style.tier === 'project' ||
    // user tier is the ONLY one HU drops, and only for localhost providers
    !LOCALHOST_BASE_URL_RE.test(input.providerBaseUrl?.trim() ?? '');

  return fileVisible ? { path: 'flag', styleName: input.style.name } : { path: 'inject', body: input.style.body, styleName: input.style.name };
}
```

`ActivationDecision` is a **discriminated union** (`libs/shared`), so the consumer physically cannot take two branches:

```ts
export type ActivationDecision = { readonly path: 'none' } | { readonly path: 'flag'; readonly styleName: string } | { readonly path: 'inject'; readonly body: string; readonly styleName: string };
```

**Why `'inert'` is gone (G5, verified).** The binary builds its style map as `{...Object.values(CwH), ...discoveredFiles}` — `CwH` is a hardcoded object literal holding `default`, `Explanatory` (`{name:"Explanatory",source:"built-in",keepCodingInstructions:!0,prompt:...}`), `Learning`, and `Proactive`. Built-ins are never file-discovered, so they can never be hidden, so a built-in can never be inert. The branch was dead state; it is removed rather than left in the union.

**Also verified from the same registry assembly — the SDK's merge order for E4.** Entries are written `_[M.name] = ...` over the concatenation `[...policySettings, ...userSettings, ...projectSettings]`, so **last write wins: project overrides user, and any file style overrides a built-in of the same name.** Ptah's discovery service must reproduce exactly this order when picking the winner for a duplicated `name`.

### 3.3 Where the decision is made — exactly one call site

`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`, at the two `AISessionConfig` object literals: **`:430-449`** (`chat:start`) and **`:961-973`** (`chat:continue`). Both already have `providerProfile` in hand from `resolveProviderProfileForWorkspace(...)` at `:425-429` and `:954-958`, and `ProviderProfile.baseUrl` (`libs/shared/src/lib/types/provider-profile.types.ts:14`) is the resolved base URL. **No new resolution work, no new async hop, no caching** — which also satisfies Req 5.6 (re-resolved per session, never cached from the previous provider).

The decision result is written to **two** new, dedicated `AISessionConfig` fields — one per branch, so the branches remain physically separate all the way to the SDK:

```ts
// libs/shared/src/lib/types/ai-provider.types.ts — new optional readonly fields,
// added directly after `workflowsDisabled` (:179).
/** Style NAME for the flag tier. Set ONLY when ActivationDecision.path === 'flag'. */
readonly outputStyleName?: string;
/** Style BODY to append. Set ONLY when ActivationDecision.path === 'inject'. */
readonly outputStyleBody?: string;
```

The resolver's union guarantees at most one of these is ever populated. A defensive assertion in the builder (`if (outputStyleName && outputStyleBody) throw`) makes a future regression loud instead of silent.

### 3.3a Flag-tier merge safety (G4)

`PTAH_DISABLE_SDK_AUTO_MEMORY` (`libs/backend/agent-sdk/src/lib/constants.ts:24-27`) is a **module-level shared object** passed by reference on every query (`sdk-query-options-builder.ts:600`). Mutating it would leak the last session's style into every subsequent session, including sessions that chose no style at all.

**EDIT** `sdk-query-options-builder.ts:600` — replace the bare reference with a fresh spread, built per session:

```ts
settings: sessionConfig?.outputStyleName
  ? { ...PTAH_DISABLE_SDK_AUTO_MEMORY, outputStyle: sessionConfig.outputStyleName }
  : PTAH_DISABLE_SDK_AUTO_MEMORY,
```

Three properties this must preserve, each asserted by a spec case (§13):

1. `autoMemoryEnabled: false` and `autoDreamEnabled: false` survive unchanged in the merged object.
2. `PTAH_DISABLE_SDK_AUTO_MEMORY` itself is **never mutated** — asserted by deep-equality against a snapshot taken before the call, and by `Object.keys(...).length === 2` after.
3. When no style is active, `outputStyle` is **absent** — not `undefined`, not `'default'`. This matters because the flag tier _outranks_ user/project/local: unconditionally sending the key would clobber a style the user chose in their own `settings.json` via the Claude Code CLI. Absence is the only correct "no opinion" value.

Recommended follow-up for the team-leader (not required by this task): promote the constant to `Object.freeze(...)` so a future accidental mutation throws in strict mode.

**Why a dedicated field instead of overloading `sessionConfig.systemPrompt`** (which `context.md` names as the hook): `systemPrompt` is already populated from `options?.systemPrompt` at `chat-session.service.ts:434`, so writing to it would either clobber a caller value or require string concatenation whose occurrence count is untestable. A dedicated field is the _same_ append slot mechanically (both land in `appendParts` inside `assembleSystemPrompt`), costs one line, follows the proven `workflowsDisabled` precedent end-to-end, and makes the single-occurrence assertion trivial. This is a refinement of the settled decision, not a reversal of it.

Consumption — **one** new line in `assembleSystemPrompt` (`sdk-query-options-builder.ts:206-228`), added after the `userSystemPrompt` block at `:219`:

```ts
if (outputStyleBody?.trim()) {
  appendParts.push(outputStyleBody);
}
```

plus `outputStyleBody` on `AssembleSystemPromptInput` and `outputStyleBody: sessionConfig?.outputStyleBody` at the `assembleSystemPrompt({...})` call in `buildSystemPrompt` (`:928-935`).

### 3.4 How a unit test proves single occurrence

> **Revised (rev 2):** adds a flag-tier merge spec (G4) and shrinks the resolver truth table to the one axis that still varies.

`libs/backend/agent-sdk/src/lib/helpers/assemble-system-prompt.output-style.spec.ts` (**CREATE**):

| Case                                                                              | Assertion                                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `outputStyleBody` set to a body containing a unique sentinel `<<STYLE_SENTINEL>>` | `content.split('<<STYLE_SENTINEL>>').length - 1 === 1` — exactly one occurrence       |
| `outputStyleBody` set **and** `userSystemPrompt` set to a different string        | both present, sentinel still count 1, `PTAH_CORE_SYSTEM_PROMPT` still count 1         |
| `outputStyleBody` undefined                                                       | `content` does not contain the sentinel; `appendParts` length unchanged from baseline |
| `outputStyleBody` = `'   '`                                                       | not appended (trim guard)                                                             |

`libs/backend/output-styles/src/lib/output-style-activation.resolver.spec.ts` (**CREATE**) — the truth table, now **`it.each` over `styleTier ∈ {user, project, plugin, builtin} × isLocalhost ∈ {true, false}` (8 rows)**, shrunk from 30 because `keyTier` no longer varies. Three invariants asserted on **every** row:

1. `decision.path === 'inject'` ⇔ `styleTier === 'user' && isLocalhost` — the single surviving axis.
2. `decision.path === 'flag'` ⇒ `decision` has no `body` property, and `decision.path === 'inject'` ⇒ `decision` has no `styleName` used for the flag tier by the consumer (structural proof the branches are disjoint).
3. `decision.path` is never `'inert'` — the value is not in the union; a compile error is the intended outcome if anyone reintroduces it.

Plus a **drift guard** in the same spec: assert `LOCALHOST_BASE_URL_RE.source` equals the literal `^https?:\/\/(127\.0\.0\.1|localhost)` — so an edit to the builder's predicate that is not mirrored here fails CI. (Note for the team-leader: `sdk-query-runner.service.ts:297` and `sdk-model-service.ts:489-492` use a _divergent_ bare `.includes('127.0.0.1')` that misses `localhost`. **Out of scope to fix** — the interactive chat path is the only one this feature runs on. Record it as a known inconsistency.)

---

## 4. Decision 3 — Merge-Preserving Settings Write, re-scoped to **CLI parity** (R2, Req 2.2/2.3/2.7, G9)

> **Revised (rev 2):** this is no longer the activation mechanism — the flag tier is. It is retained, unchanged in implementation, as an **opt-in CLI-parity write**, which was the user's stated value proposition ("a style chosen in Ptah also applies when the user runs `claude` directly"). `claude-settings.writer.ts` and its spec survive intact. What changes is _when it runs_ and _which file it targets by default_.

### 4.1 Activation vs parity — now two different things

|                                   | Activation (in Ptah)             | Parity (outside Ptah)           |
| --------------------------------- | -------------------------------- | ------------------------------- |
| Mechanism                         | flag tier via `Options.settings` | `.claude/settings.json` write   |
| Runs                              | every session, automatically     | only when the user opts in      |
| Fails how                         | cannot fail — no file I/O        | file error, surfaced, non-fatal |
| Required for the feature to work? | **yes**                          | **no**                          |

A failed parity write therefore **must not** roll back or block the selection. The style is already active. This is a strict improvement on Req 2.7: the previous design had to keep the selection consistent with a write that could fail; now the selection is authoritative and the write is advisory.

### 4.2 Which file — decided (E2)

**Default target: `<workspaceRoot>/.claude/settings.json` (project tier), and parity is OPT-IN (default off).**

This reverses rev 1's local-tier default, and the reason is that the tier's job changed. When the write was the _activation_ mechanism, `settings.local.json` was right because it is gitignored and always in `settingSources`. Now that activation is handled by the flag tier, neither property matters: the **only** purpose of the write is to be seen by a `claude` process the user starts themselves, and the tier that best serves "this project should sound like this" is the committable project tier.

Because that tier is committable, R6 (tier confusion) is now a _real_ consequence rather than a hypothetical, and it is mitigated by making the whole feature opt-in behind an explicit checkbox — "Also apply this style when I run `claude` in this project" — that names the exact file before it is written. Tier remains user-selectable to `~/.claude/settings.json` (all projects) or `.claude/settings.local.json` (this project, not committed).

The UI names the exact workspace-relative file it wrote (Req 2, E2). The localhost-inert warning is **no longer attached to this control** — it belongs to the style file's tier, not the settings key's (§3.1).

### 4.3 The write — reuse, do not invent (unchanged from rev 1)

`libs/backend/output-styles/src/lib/claude-settings.writer.ts` (**CREATE**).

The port has **no `rename`** (`file-system-provider.interface.ts` — 13 members, none of them `rename`/`move`), so a true tmp+rename atomic write is not expressible through `IFileSystemProvider`, and NFR forbids dropping to `node:fs`. Adding `rename` to the port would mean editing three adapters plus the shared contract suite — disproportionate, and the VS Code adapter would need a virtual-FS carve-out exactly like `createDirectoryExclusive` (`vscode-file-system-provider.ts:126-137`).

**Reuse the pattern the repo already chose for this exact shape of problem**: `TaskWriterService.applyFrontmatterPatch` (`libs/backend/task-specs/src/lib/task-writer.service.ts:587-698`) — optimistic concurrency via pre-write re-read, honestly documented at `:648-651` as narrowing rather than closing the window.

Sequence for `setOutputStyle(tier, styleName | null)`:

1. `resolveTargetPath(tier)` → absolute path. `~` resolution uses the `homedir()`-with-override idiom that is canonical in this repo (`file-settings-manager.ts:68-69`); the override parameter is what the specs use.
2. `const existed = await fs.exists(target)`.
3. If `existed`: `const raw = await fs.readFile(target)`; else `raw = ''`.
4. **Parse.** `raw.trim() === ''` → `{}`. Otherwise `JSON.parse`. On throw → **abort**, return `{ success: false, error: { code: 'SETTINGS_MALFORMED', message } }` where `message` names the **workspace-relative** path and the parser's position (`SyntaxError.message` is sanitised to strip absolute paths). **Never** reset to `{}` — this file is not ours (this is the deliberate divergence from `PtahFileSettingsManager.loadSync`, `file-settings-manager.ts:460-476`).
5. Reject a non-object root (`Array.isArray` / `typeof !== 'object'` / `null`) with the same code.
6. **Merge.** `const next = { ...parsed }`. `styleName === null || styleName === 'default'` → `delete next['outputStyle']` (Req 2.4). Else `next['outputStyle'] = styleName` (the frontmatter **`name`**, never the filename — E1). Every other key is carried by spread, untouched.
7. **Backup.** If `existed && raw.length > 0`: `await fs.writeFile(target + '.ptah-bak', raw)`. Precedent: `mcp-config-io.utils.ts:49-51`. This is the truncation insurance the missing `rename` costs us.
8. **Pre-write re-read.** `const check = await fs.readFile(target)` (if `existed`); if `check !== raw` → abort `{ code: 'SETTINGS_CONFLICT' }`, leave the previous selection intact (Req 2.7).
9. `await fs.writeFile(target, JSON.stringify(next, null, 2) + '\n')` — `IFileSystemProvider.writeFile` creates parent directories (contract, `file-system-provider.interface.ts:34`), which satisfies Req 2.3 with no extra `createDirectory` call.
10. On success: `await fs.delete(target + '.ptah-bak')` (best-effort, errors swallowed). On step-9 throw: leave the `.ptah-bak` in place and name it in the error.
11. Return `{ success: true, writtenPath: <workspace-relative>, tier }` so the UI can name the file.

Formatting note: 2-space `JSON.stringify` + trailing newline matches `PtahFileSettingsManager.persist` (`file-settings-manager.ts:489`) and is what the Claude Code CLI itself emits. JSON has no comments, so Req 2.2's "comments-free JSON formatting" is satisfied by construction; key **order** is preserved by object spread for all pre-existing keys.

---

### 4.4 `resolveSettings()` — adopt for tests, reject for runtime (G3)

`resolveSettings(opts)` (`sdk.d.ts:2414`, `@alpha`) runs the CLI's own merge engine in-process, accepting `cwd` and `settingSources`, and returns `sources: Array<{ source: ResolvedSettingSource; settings; path? }>` low→high, where `ResolvedSettingSource = SettingSource | 'managed' | 'flag'` (`sdk.d.ts:2388`).

- **(a) Runtime use inside the discovery service — REJECTED.** It resolves _settings_, not the output-style **file** cascade, so it cannot tell Ptah which style files exist or which wins a name collision; and it is `@alpha` with documented divergences (`policyHelper` not executed, `permissions.defaultMode` unfiltered) that would put an unstable dependency on the feature's hot path for no coverage gain.
- **(b) Test use — ADOPTED.** It is the ideal oracle for one high-value integration spec: write a fixture `.claude/settings.json`, call `resolveSettings({ cwd, settingSources })`, and assert that the tier Ptah's `ClaudeSettingsWriter` targeted is the tier that actually wins — proving the parity write lands where Ptah's UI claims it landed. Spec named in §13. Gate it behind an availability check so an alpha-API removal degrades to a skip, not a red build.

### 4.5 The `turnReminder` — built-in only; do not promise per-turn reinforcement (G7)

The binary injects the reminder as `[{type:"output_style", style:q, turnReminder:K?.turnReminder}]`, and the renderer falls back to a generic string: `turnReminder??"Remember to follow the specific guidelines for this style."`. The `turnReminder` value is a property of the **built-in** style definitions in `CwH` (it appears inline beside `Explanatory:{name:"Explanatory",source:"built-in",…}`).

The frontmatter schema is `.strict()` with exactly four keys and **no `turn-reminder` member**, so a user- or project-authored style **can never carry a custom turn reminder**. It receives the generic fallback sentence.

**Product consequence, to be honoured in UI copy**: a custom style is reinforced once per turn by a generic reminder, not by style-specific text. Do not describe custom styles as having per-turn reinforcement tailored to their content, and do not build a UI field for it — a fifth frontmatter key would void the file under `.strict()`.

### 4.6 What `keep-coding-instructions: false` actually means **inside Ptah** (G8)

Turning the toggle OFF has a materially milder effect in Ptah than in the raw CLI, and Requirement 6's copy must say what is true _here_.

|                                         | Raw `claude` CLI                                       | Ptah                                                                              |
| --------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| SDK default coding-instructions section | **removed**                                            | **removed** (identical)                                                           |
| `PTAH_CORE_SYSTEM_PROMPT`               | not present                                            | **still appended, unconditionally** (`sdk-query-options-builder.ts:216`)          |
| Net effect                              | the style largely defines the agent's engineering role | the style replaces one section; Ptah's own, longer behaviour prompt still governs |

In the CLI, OFF is close to "this style becomes the agent's role". In Ptah, OFF removes the SDK's section while Ptah's core prompt — the longer and stronger voice — remains in place. The practical degradation is real but bounded.

**Required copy change (Req 6.3).** The OFF warning must not say "this replaces the agent's coding instructions" without qualification, because in Ptah that overstates the effect. Use wording of this shape:

> Turning this off removes the SDK's built-in coding instructions. Ptah's own engineering behaviour still applies, so the effect is smaller here than in the `claude` CLI — but the agent loses guidance it normally has. Recommended only for styles that redefine the agent's whole role.

This is the same honesty constraint as R1 (§12.6): describe influence, not governance.

## 5. Decision 4 — Frontmatter Parse + Serialize

### 5.1 Library: `gray-matter` — reuse, no new dependency

Already a root dependency (`package.json:156`, `^4.0.3`) and already the repo's frontmatter reader (`libs/backend/task-specs/src/lib/task-frontmatter.ts:13`). No `js-yaml`/`yaml` is added.

**Carry the known gotcha forward.** `task-frontmatter.ts:79-103` documents that every `matter()` call must be passed a per-call options object to defeat gray-matter's module-global cache, which otherwise makes malformed-file diagnosis non-deterministic. Declare `const MATTER_OPTIONS = { language: 'yaml' } as const;` in the new module and pass it to **every** call. Serialize with `matter.stringify('', data).replace(/\n$/, '')` — the trailing-newline strip at `task-frontmatter.ts:584` is load-bearing (without it blank lines accumulate at the block/body boundary on every save, corrupting Req 4.3's "body preserved verbatim").

### 5.2 Zod schema — location and pin

`libs/backend/output-styles/src/lib/output-style-frontmatter.schema.ts` (**CREATE**) — the single named location required by R4:

```ts
/**
 * Mirror of the Claude Agent SDK output-style frontmatter schema.
 *
 * PINNED TO SDK v0.3.150. Source of truth: the zod `.strict()` schema inside
 * node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe, cross-read
 * against node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts (Settings,
 * sdk.d.ts:5037). Exactly four keys; any fifth key voids the file.
 *
 * UPGRADE CHECKPOINT (R4): if the SDK minor version changes, re-verify this
 * schema. A drift makes Ptah reject files the SDK accepts, or vice versa.
 */
export const SDK_OUTPUT_STYLE_VERSION_PIN = '0.3.150' as const;

export const OUTPUT_STYLE_FRONTMATTER_KEYS = ['name', 'description', 'keep-coding-instructions', 'force-for-plugin'] as const;

export const OutputStyleFrontmatterSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    'keep-coding-instructions': z.boolean().optional(),
    'force-for-plugin': z.boolean().optional(),
  })
  .strict();
```

### 5.3 Key normalisation

The SDK reads with `normalizeKeys: true`, so `keepCodingInstructions` and `keep-coding-instructions` are both accepted on disk. Ptah must match that verdict exactly (NFR: "Ptah's verdict on a file matches the SDK's"). Therefore:

- **On read**: a `normalizeFrontmatterKeys()` pre-pass camelCase→kebab-case-folds the four known keys _before_ `.strict()` runs, so a camelCase file is valid, not rejected.
- **On write**: always emit **kebab-case** — matching the reference fixture (`.claude/output-styles/simplified-technical-english.md:4`).

### 5.4 Strict rejection naming the offending key (Req 7.2)

Zod's `.strict()` failure emits an issue with `code === 'unrecognized_keys'` carrying `keys: string[]`. Map it in `toValidationError()`:

```ts
{
  code: 'UNRECOGNIZED_KEY',
  key: issue.keys[0],
  validKeys: OUTPUT_STYLE_FRONTMATTER_KEYS,
  message: `"${issue.keys[0]}" is not a valid output-style setting. Valid settings are: name, description, keep-coding-instructions, force-for-plugin.`,
}
```

The message is a **formatted diagnostic** — no raw exception text, no absolute host path (NFR, Req 7.6). Malformed YAML (`matter()` throws) maps to `{ code: 'YAML_PARSE', line?, message }`, taking `line`/`column` from the js-yaml `YAMLException.mark` when present (Req 7.3), falling back to a line-less message when not.

### 5.5 Name-vs-filename and derived description (E1, Req 1.4, Req 8.2)

- `name` resolution: `frontmatter.name?.trim() || basename(file, '.md')`. **Everything downstream keys on `name`.** The filename is storage/presentation only. `outputStyle` is never written a filename.
- `description` fallback: first non-heading, non-empty paragraph of the trimmed body, collapsed to a single line and truncated to 160 chars — the "derived body summary" of Req 1.4.
- `keepCodingInstructions`: `frontmatter['keep-coding-instructions'] === true` (absent/false both mean "replaces", per the binary's `(style === null || style.keepCodingInstructions === true)` assembly).

### 5.6 Slug safety (Req 3.4, NFR)

`libs/backend/output-styles/src/lib/output-style-slug.ts` (**CREATE**): lowercase, NFKD-strip, non-`[a-z0-9-]` → `-`, collapse runs, trim leading/trailing `-`, reject empty, cap at 64 chars, reject `.`/`..`, reject path separators and drive-colons pre-normalisation, and reject reserved Windows device names (`CON PRN AUX NUL COM1-9 LPT1-9`, case-insensitive, with or without extension). Collision with an existing file in that tier → `{ code: 'FILE_EXISTS' }` unless `overwrite: true` was passed.

---

## 6. Decision 5 — RPC Namespace

### Namespace: `outputStyle:` (trailing **colon** — the allowlist format is `'tasks:'`, not `'tasks.'`)

> **Revised (rev 2):** `activate` no longer takes a `keyTier` and no longer depends on a file write. It persists Ptah's own selection and optionally mirrors it for CLI parity. Parity failure is reported without failing activation.

| Method                 | Params → Result                                                                                                                                                      | Serves         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `outputStyle:list`     | `{ workspaceRoot? }` → `{ styles: OutputStyleEntry[]; invalid: InvalidOutputStyle[]; active: ActiveOutputStyleState }`                                               | Req 1, 7.1, 8  |
| `outputStyle:get`      | `{ workspaceRoot?; name; tier }` → `{ style: OutputStyleDetail \| null }` (body + `mtime` for E8)                                                                    | Req 4.3, 7.5   |
| `outputStyle:activate` | `{ workspaceRoot?; name \| null; parity?: { enabled: boolean; tier: SettingsTier } }` → `{ success; decision; parity?: { written: boolean; writtenPath?; error? } }` | Req 2, 5.4/5.5 |

**Where Ptah's own selection is persisted.** Activation now needs a Ptah-side home for "which style did the user pick", because the flag tier is computed per session rather than read from a file. This is exactly what `settings-core` is for, and it needs no new lib: add a `defineSetting()` entry (`outputStyle.selectedName`, workspace-scoped) to the settings schema and read it through the existing `SETTINGS_TOKENS.SETTINGS_STORE`. This is the one place `settings-core` is touched, and it is touched for its actual concern — Ptah's own `~/.ptah/settings.json` — which is consistent with §2's rejection of putting _foreign_ file ownership there.
| `outputStyle:save` | `{ workspaceRoot?; tier; name; description; keepCodingInstructions; body; originalName?; expectedMtime?; overwrite? }` → `{ success; path?; error? }` | Req 3, 4.3, 4.4, E8 |
| `outputStyle:delete` | `{ workspaceRoot?; name; tier; }` → `{ success; clearedActive: boolean; error? }` | Req 4.5, 4.6 |
| `outputStyle:diagnose` | `{ workspaceRoot? }` → `{ decision; visibleTiers; keyTier; keyPath; activeMissing: boolean }` | Req 5.4, E5 |

`save` is an upsert (create + edit), so Req 4.4 ("rename an active style updates `outputStyle` in the same operation") is a single server-side transaction rather than a client-orchestrated two-step.

### Registration site A — compile-time (four blocks, all in `libs/shared`)

1. **CREATE** `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-output-style.types.ts` — all `*Params`/`*Result` interface pairs, plus `OutputStyleEntry`, `OutputStyleTier`, `SettingsTier`, `ActivationDecision`, `InvalidOutputStyle`, `ActiveOutputStyleState`. Copy the header-comment convention from `rpc-tasks.types.ts:1-11` (which states the dual-registration rule inline). Param-less methods use a `type` alias, not an empty interface (`rpc-tasks.types.ts:259`).
2. **EDIT** `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts` — add `export * from './rpc/rpc-output-style.types';` beside the existing re-export at `:32`.
3. **EDIT** same file — add the `import type { ... }` block next to the tasks block at `:490-517`.
4. **EDIT** same file — add 6 entries to `RpcMethodRegistry` (declared `:535`) **and** 6 keys to `RPC_METHOD_ENTRIES` (`:2662`). Skipping the latter is a compile error (`Record<RpcMethodName, true>`), which is the intended guard.

### Registration site B — runtime guard (the one that crashes silently if missed)

**EDIT** `D:/projects/ptah-extension/libs/backend/vscode-core/src/messaging/rpc-handler.ts` — the `ALLOWED_METHOD_PREFIXES` array declared at `:40`. Exact edit: insert one line, after the `'mcpDirectory:'` entry, before `'cron:'`:

```ts
  'outputStyle:', // Claude Code output styles (list, get, activate, save, delete, diagnose)
```

Guard that consumes it: `isValidMethodName` (`:258-260`) → throw at `:131-137`.

### Registration site C — the handler manifest (a third site the requirements did not name; missing it fails CI)

**EDIT** `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`. The `RPC_HANDLER_MANIFEST` array is declared at `:113` and closes at `:382`; group 1 (`requires: []`, all hosts) spans `:115-258` and is **alphabetical by key**. Insert between `mcpDirectory` (`:182`) and `plugin` (`:188`):

```ts
  {
    key: 'outputStyle',
    methods: OutputStyleRpcHandlers.METHODS,
    requires: [],
    handler: OutputStyleRpcHandlers,
  },
```

`requires: []` because the feature needs only `IFileSystemProvider` + `IWorkspaceProvider`, which every host has. No new `Capability` is added.

**The existing spec `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts` is the enforcement mechanism** for all three sites: `:41` asserts every registry method has exactly one manifest owner, `:59` and `:84` assert every method's prefix is in `ALLOWED_METHOD_PREFIXES`. If the team-leader batches sites A/B/C separately, that spec will be red between batches — expected, and it is the signal that the set is incomplete.

---

## 7. Decision 6 — Plugin-Tier Discovery (Req 1.1/1.3, E6)

> **Revised (rev 2):** G6 partially verified. Plugin styles are namespaced and name-keyed exactly as assumed, but whether they load _in a Ptah session_ is UNVERIFIED. P5 stays deferred, now on stronger evidence.

**G6 — is `${plugin}:${style}` accepted as an `outputStyle` value?** The binary's plugin loader builds each entry as `` O=`${q}:${Y}` `` and returns `{name:O, description:M, prompt:A.trim(), source:"plugin", …}`; the registry then writes `_[M.name] = …` and the active-style lookup is a plain `return H[_]??null` keyed by that same name. So the namespaced identifier **is** a valid `outputStyle` value by construction — _provided the plugin's styles were loaded into the map_.

That proviso is the unverified part, and it is Ptah-specific. `SkillJunctionService` (`libs/backend/agent-sdk/src/lib/helpers/skill-junction.service.ts:8-10`) documents that "the SDK's `plugins` option does NOT reliably load skills", which is why Ptah junctions plugin skills into `.claude/skills/` instead. `pluginPaths` is threaded into the builder (`sdk-query-options-builder.ts:275/472`) but only **logged** (`pluginCount`, `:584`) — it is not passed to the SDK. So in a Ptah session today there is no evidence any plugin content, output styles included, reaches the SDK's loader at all.

**Verifying it requires a live session** with a plugin that actually ships an `output-styles/` directory — and no plugin anywhere in this repo does. Design defensively: list plugin styles read-only if they are discoverable, mark them non-activatable-by-Ptah until proven otherwise, and do not write a `${plugin}:${style}` value into any settings file.

### Verdict: **in scope, sequenced last (Phase 5), read-only, and deferrable without breaking anything else**

Feasibility is confirmed, not assumed. `PluginLoaderService.resolveCurrentPluginPaths()` (`libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:554`) already returns the absolute roots of every loaded plugin, encoding both activation models (opt-in bundled, opt-out harness). `countPluginCommands()` (`:293`) is a working 8-line template for "readdir one subdirectory of a plugin root, tolerate ENOENT". Plugins live at `~/.ptah/plugins/<pluginId>/`.

Implementation: `IPluginRootsSource` port declared in the new lib; `PluginLoaderService`-backed adapter registered in the three composition roots (keeps `output-styles` free of an `agent-sdk` dependency). For each root: read `<root>/.claude-plugin/plugin.json`; **if it has an `outputStyles` key, do not scan `<root>/output-styles/`** (E6 — the SDK suppresses auto-load in that case); otherwise scan it. Namespace each entry `${pluginId}:${styleName}` (Req 1.3). Never editable or deletable (Req 4.2, out-of-scope list).

**Honest expectation, stated so it is not mistaken for a regression**: no plugin in this repo ships an `output-styles/` directory today, and nothing in the codebase parses `plugin.json` at all. Phase 5 therefore returns an **empty list in practice**. It is correctness insurance for third-party plugins, not user-visible value. If the team-leader needs to cut scope, cut Phase 5 — and record in the task that Req 1.1/1.3/E6 are satisfied structurally (tier modelled, namespacing implemented in the list renderer) with the enumerator stubbed to `[]`. Do not silently drop the requirement.

Also worth budgeting if plugin styles are ever _shipped_ by Ptah: `content-download.service.ts:265-275` (`pruneStaleFiles`) deletes any file under `~/.ptah/plugins` not listed in `content-manifest.json`. That is a separate task.

---

## 8. Decision 7 — Built-In Styles

`libs/backend/output-styles/src/lib/built-in-output-styles.ts` (**CREATE**) — a hardcoded, frozen constant. **A `.ts` file, deliberately**, because it compiles into `main.mjs` and is therefore marketplace-safe (see §12).

```ts
export const BUILT_IN_OUTPUT_STYLES: readonly OutputStyleEntry[] = Object.freeze([
  { name: 'default', tier: 'builtin', description: '…', keepCodingInstructions: true, editable: false, deletable: false, body: undefined, immutableReason: 'built-in' },
  { name: 'Explanatory', tier: 'builtin' /* … */ },
  { name: 'Learning', tier: 'builtin' /* … */ },
  { name: 'Proactive', tier: 'builtin' /* … */ },
]);
```

Casing is verbatim from the binary — `default` lowercase, the other three capitalised. `outputStyle` binds by exact `name`, so the casing is load-bearing, not cosmetic.

> **Revised (rev 2):** G5 verified — built-ins resolve through the flag tier like any other name. The binary seeds its style map from `Object.values(CwH)` (a hardcoded object literal: `Explanatory:{name:"Explanatory",source:"built-in",keepCodingInstructions:!0,prompt:…}`) **before** merging discovered files, so built-ins are never file-discovered and never gated by `settingSources`. They activate on every provider, including localhost proxies. The `'inert'` branch is therefore removed from `ActivationDecision` (§3.2). `body: undefined` remains correct on these entries — a built-in is never injected because it never needs to be.
>
> One consequence worth encoding: because file styles are written into the map **after** built-ins, **a user file named `Learning` silently shadows the built-in `Learning`.** Discovery must flag this as a collision (E4) rather than showing two identically-named rows with no explanation.

**Non-editability is data, not a UI convention**: `editable: false` / `deletable: false` / `immutableReason: 'built-in'` are fields on `OutputStyleEntry`, set identically for plugin styles (`immutableReason: 'plugin:<id>'`). The list component renders a disabled control plus the reason string — never a silently missing button (Req 4.2). Plugin/built-in entries also carry `body: undefined`, which is what makes `path: 'inert'` (not `'inject'`) structurally unavoidable for a built-in in §3.2.

`default` is a sentinel, not a real style: selecting it routes to the key-removal branch of `ClaudeSettingsWriter` (Req 2.4).

---

## 9. Files — Complete Manifest

### 9.1 CREATE — new backend lib `libs/backend/output-styles`

All paths absolute, all **CREATE**.

| Path                                                                                           | Purpose                                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `D:/projects/ptah-extension/libs/backend/output-styles/project.json`                           | Nx project, name `@ptah-extension/output-styles`, tags `["scope:extension","type:feature"]`, esbuild cjs (copy `libs/backend/task-specs/project.json`) |
| `.../output-styles/package.json`                                                               | `"@ptah-extension/output-styles"`, private, commonjs                                                                                                   |
| `.../output-styles/tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `jest.config.ts` | standard, copied from `task-specs`                                                                                                                     |
| `.../output-styles/src/index.ts`                                                               | barrel                                                                                                                                                 |
| `.../src/lib/di/tokens.ts`                                                                     | `OUTPUT_STYLE_TOKENS`                                                                                                                                  |
| `.../src/lib/di/register.ts`                                                                   | `registerOutputStyleServices(container, logger)`                                                                                                       |
| `.../src/lib/output-style-frontmatter.schema.ts`                                               | Zod `.strict()` schema, SDK pin (§5.2)                                                                                                                 |
| `.../src/lib/output-style-frontmatter.ts`                                                      | `parseOutputStyleFile`, `serializeOutputStyleFile`, `normalizeFrontmatterKeys`, `deriveDescription`, `toValidationError`                               |
| `.../src/lib/output-style-slug.ts`                                                             | `slugifyStyleName` (§5.6)                                                                                                                              |
| `.../src/lib/built-in-output-styles.ts`                                                        | the four built-ins (§8)                                                                                                                                |
| `.../src/lib/output-style-discovery.service.ts`                                                | `@injectable()`; scans tiers, merges, flags collisions (E4), resolves the active winner                                                                |
| `.../src/lib/output-style-file.writer.ts`                                                      | `@injectable()`; create/edit/delete + mtime guard (E8)                                                                                                 |
| `.../src/lib/claude-settings.writer.ts`                                                        | `@injectable()`; merge-preserving RMW (§4.2)                                                                                                           |
| `.../src/lib/output-style-activation.resolver.ts`                                              | `resolveActivation()` + `@injectable() OutputStyleActivationResolver` (§3.2)                                                                           |
| `.../src/lib/plugin-roots.port.ts`                                                             | `IPluginRootsSource` + `PLUGIN_ROOTS_SOURCE_TOKEN` (Phase 5)                                                                                           |
| `.../src/lib/__fixtures__/output-style.fixtures.ts`                                            | **inline TS string constants**, not `.md` files (§12)                                                                                                  |
| `.../src/lib/output-style-frontmatter.spec.ts`                                                 | §11                                                                                                                                                    |
| `.../src/lib/output-style-slug.spec.ts`                                                        | §11                                                                                                                                                    |
| `.../src/lib/output-style-discovery.service.spec.ts`                                           | §11                                                                                                                                                    |
| `.../src/lib/claude-settings.writer.spec.ts`                                                   | §11                                                                                                                                                    |
| `.../src/lib/output-style-activation.resolver.spec.ts`                                         | §11                                                                                                                                                    |
| `.../output-styles/CLAUDE.md`                                                                  | lib doc (module-index convention)                                                                                                                      |

### 9.2 CREATE — RPC + shared

| Path                                                                                                      | Kind                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-output-style.types.ts`                      | CREATE                                                                                                                                                                                            |
| `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/output-style-rpc.schema.ts`        | CREATE — Zod param schemas                                                                                                                                                                        |
| `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/output-style-rpc.handlers.ts`      | CREATE — `@injectable()`, `static readonly METHODS … as const satisfies readonly RpcMethodName[]`, `register()` fan-out, private `parse()` + `sanitize()` (copy `tasks-rpc.handlers.ts:995-1021`) |
| `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/output-style-rpc.handlers.spec.ts` | CREATE                                                                                                                                                                                            |

### 9.3 CREATE — frontend (all inside `libs/frontend/chat/src/lib/settings/output-style/`)

| Path                                                              | Kind                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `.../settings/output-style/output-style.store.ts`                 | CREATE — `@Injectable({providedIn:'root'})` signal store                |
| `.../settings/output-style/output-style-config.component.ts`      | CREATE — `ptah-output-style-config`, section shell + list/editor switch |
| `.../settings/output-style/output-style-list.component.ts`        | CREATE — `ptah-output-style-list`                                       |
| `.../settings/output-style/output-style-editor.component.ts`      | CREATE — `ptah-output-style-editor`                                     |
| `.../settings/output-style/output-style.store.spec.ts`            | CREATE                                                                  |
| `.../settings/output-style/output-style-editor.component.spec.ts` | CREATE                                                                  |

### 9.4 EDIT — surgical, function/section named

| Path                                                                                                                                                | Section touched                                                                                                                                                                                                                    | Change                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `D:/projects/ptah-extension/tsconfig.base.json`                                                                                                     | `compilerOptions.paths` (near `:108-120`)                                                                                                                                                                                          | +1 line: `"@ptah-extension/output-styles": ["./libs/backend/output-styles/src/index.ts"]` ⚠️ shared file                                                                                                                                                       |
| `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts`                                                                                 | re-export block (`:32`), `import type` block (`:490-517`), `RpcMethodRegistry` (`:535`), `RPC_METHOD_ENTRIES` (`:2662`)                                                                                                            | 4 insertions ⚠️ shared file                                                                                                                                                                                                                                    |
| `D:/projects/ptah-extension/libs/backend/vscode-core/src/messaging/rpc-handler.ts`                                                                  | `ALLOWED_METHOD_PREFIXES` array (`:40`)                                                                                                                                                                                            | +1 line `'outputStyle:',` ⚠️ shared file                                                                                                                                                                                                                       |
| `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`                                                             | `RPC_HANDLER_MANIFEST` group 1, between `:182` and `:188`                                                                                                                                                                          | +1 entry, +1 import                                                                                                                                                                                                                                            |
| `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/index.ts`                                                                    | export list                                                                                                                                                                                                                        | +1 `export { OutputStyleRpcHandlers } …`                                                                                                                                                                                                                       |
| `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/index.ts`                                                                                 | handlers re-export block                                                                                                                                                                                                           | +1 name                                                                                                                                                                                                                                                        |
| `D:/projects/ptah-extension/libs/shared/src/lib/types/ai-provider.types.ts`                                                                         | `AISessionConfig`, immediately after `workflowsDisabled` (`:179`)                                                                                                                                                                  | **rev 2:** +2 optional readonly fields — `outputStyleName?: string`, `outputStyleBody?: string`                                                                                                                                                                |
| `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`                                                    | **(a)** the `settings:` property at `:600`; **(b)** `AssembleSystemPromptInput` (`:172` region); **(c)** `assembleSystemPrompt` body (after `:219`); **(d)** `buildSystemPrompt`'s `assembleSystemPrompt({...})` call (`:928-935`) | **rev 2:** (a) is the new flag-tier spread (§3.3a) — a 3-line conditional replacing a 1-line reference; (b) +1 field; (c) +3 lines; (d) +1 line. Plus the defensive both-fields-set assertion.                                                                 |
| `D:/projects/ptah-extension/libs/backend/settings-core/src/schema/index.ts` (+ a new `output-style-schema.ts` beside the other `*-schema.ts` files) | schema barrel                                                                                                                                                                                                                      | **rev 2, NEW:** one `defineSetting()` entry `outputStyle.selectedName` (workspace-scoped) so Ptah can persist the user's choice. `settings-core` has no `register.ts`; the store is already registered by each platform adapter, so no adapter edit is needed. |
| `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`                                                 | the two `AISessionConfig` literals at `:430-449` and `:961-973`                                                                                                                                                                    | +1 resolver call + `outputStyleBody:` in each literal; +1 ctor `@inject`                                                                                                                                                                                       |
| `D:/projects/ptah-extension/apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`                                                                 | `registerPhase2Libraries` (`:46`), beside `registerTaskSpecsServices` (`:56`)                                                                                                                                                      | +1 call + import                                                                                                                                                                                                                                               |
| `D:/projects/ptah-extension/apps/ptah-electron/src/di/phase-2-libraries.ts`                                                                         | `registerPhase2Libraries` (`:87`), beside `:177`                                                                                                                                                                                   | +1 call + import                                                                                                                                                                                                                                               |
| `D:/projects/ptah-extension/libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts`                                                      | `registerThothLibraries` (`:49`), beside `:125`                                                                                                                                                                                    | +1 call + import                                                                                                                                                                                                                                               |
| `D:/projects/ptah-extension/libs/frontend/chat/src/lib/settings/index.ts`                                                                           | barrel (19 lines)                                                                                                                                                                                                                  | +1 `export { OutputStyleConfigComponent } from './output-style/output-style-config.component';`                                                                                                                                                                |
| `D:/projects/ptah-extension/libs/frontend/chat/src/lib/settings/settings.component.ts`                                                              | `imports` array (`:58-71`) only                                                                                                                                                                                                    | +1 import statement, +1 array entry. **Nothing else in this file.**                                                                                                                                                                                            |
| `D:/projects/ptah-extension/libs/frontend/chat/src/lib/settings/settings.component.html`                                                            | inside `@if (activeSettingsTab() === 'pro-features')` (`:183-188`), after `<ptah-enhanced-prompts-config />` (`:184`)                                                                                                              | +1 line `<ptah-output-style-config />`                                                                                                                                                                                                                         |
| `D:/projects/ptah-extension/CLAUDE.md`                                                                                                              | Backend Libs module index                                                                                                                                                                                                          | +1 line                                                                                                                                                                                                                                                        |

**Explicitly NOT touched**: `app-shell.component.ts`, `app-shell.component.html`, anything in `libs/frontend/core`, `apps/ptah-extension-webview/src/app/app.config.ts`, `apps/ptah-electron-e2e/**`, `marketing/**`, `PTAH_CORE_SYSTEM_PROMPT`, and the `settingSources` branches themselves.

---

## 10. DI Tokens, `register.ts`, and Registration Phase

`libs/backend/output-styles/src/lib/di/tokens.ts` (**CREATE**) — `Symbol.for(...)`, `as const`, matching the `SETTINGS_TOKENS` / `TASK_SPECS_TOKENS` convention:

```ts
export const OUTPUT_STYLE_TOKENS = {
  DISCOVERY: Symbol.for('OutputStyleDiscovery'),
  FILE_WRITER: Symbol.for('OutputStyleFileWriter'),
  CLAUDE_SETTINGS_WRITER: Symbol.for('OutputStyleClaudeSettingsWriter'),
  ACTIVATION_RESOLVER: Symbol.for('OutputStyleActivationResolver'),
} as const;
```

`PLUGIN_ROOTS_SOURCE_TOKEN` lives separately in `plugin-roots.port.ts` (ISP — the seam has one consumer), mirroring `TASK_INDEX_NOTIFIER_TOKEN`.

`libs/backend/output-styles/src/lib/di/register.ts` (**CREATE**):

```ts
export function registerOutputStyleServices(container: DependencyContainer, logger: Logger): void {
  container.registerSingleton(OutputStyleDiscoveryService);
  container.registerSingleton(OutputStyleFileWriter);
  container.registerSingleton(ClaudeSettingsWriter);
  container.registerSingleton(OutputStyleActivationResolver);
  container.register(OUTPUT_STYLE_TOKENS.DISCOVERY, { useToken: OutputStyleDiscoveryService });
  container.register(OUTPUT_STYLE_TOKENS.FILE_WRITER, { useToken: OutputStyleFileWriter });
  container.register(OUTPUT_STYLE_TOKENS.CLAUDE_SETTINGS_WRITER, { useToken: ClaudeSettingsWriter });
  container.register(OUTPUT_STYLE_TOKENS.ACTIVATION_RESOLVER, { useToken: OutputStyleActivationResolver });
}
```

**Which app phase**: **Phase 2 (libraries)** on VS Code and Electron; `registerThothLibraries` on the CLI. Placed **beside the existing `registerTaskSpecsServices(container, logger)` call** in each — `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:56`, `apps/ptah-electron/src/di/phase-2-libraries.ts:177`, `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:125`. Phase 2 is correct because these services depend only on Phase 1 platform adapters (`FILE_SYSTEM_PROVIDER`, `WORKSPACE_PROVIDER`) and are consumed by Phase 3/4 handlers.

**The RPC handler needs zero app edits.** `OutputStyleRpcHandlers` is `@injectable()` with all-`@inject` constructor args and has a manifest entry with `requires: []`, so `registerHandlers` (`host-profile/register-rpc-surface.ts:176-196`) resolves it on demand on all three hosts. It does **not** go in `registerSharedRpcHandlers` — that list is only for classes needing per-app factories.

---

## 11. Frontend Component Tree

All components: `standalone: true`, `ChangeDetectionStrategy.OnPush`, `inject()`, signals, `host: { class: 'mt-4 block' }`, daisyUI classes matched to `workflows-config.component.ts` (card `border border-secondary/30 rounded-md bg-secondary/5` + inner `p-3`; heading `text-xs font-medium uppercase tracking-wide`; body `text-xs text-base-content/70`; hints `text-[10px] text-base-content/50`; errors `text-xs text-error`).

**Forms: signal-backed template-driven**, `[value]="sig()"` + `(input)/(change)` → `sig.set(...)`. Evidence: a workspace-wide search for `FormBuilder|ReactiveFormsModule|FormGroup` under `libs/frontend` returns zero real usages; `oauth-surface.component.ts:111-194` is the canonical example. Do not introduce reactive forms.

```
OutputStyleConfigComponent            <ptah-output-style-config />
├─ signal view = 'list' | 'editor'
├─ injects OutputStyleStore
│
├─ @if (view() === 'list')
│   └─ OutputStyleListComponent       <ptah-output-style-list />
│       ├─ input: styles, invalid, active, busy
│       ├─ output: activate(name|null), edit(name,tier), create(), remove(name,tier)
│       ├─ per row: name · tier badge (user|project|plugin|built-in) · description
│       │           · active check (Req 1.6) · disabled edit/delete + immutableReason (Req 4.2)
│       ├─ invalid rows rendered inline, non-selectable, with the formatted
│       │   diagnostic and an "Open to fix" action for user/project tiers (Req 7.1/7.4/7.5)
│       ├─ collision banner when two tiers share a name (E4)
│       ├─ missing-active banner naming the orphan value + "Revert to default" (E5)
│       ├─ fallback banner when store.decision().path === 'inject' — plain words,
│       │   plus a "Copy to project tier" action (Req 5.4 / 5.5).  rev 2: the
│       │   trigger is now ONLY "user-tier style file + localhost provider";
│       │   the copy says the provider does not read user-level style files,
│       │   NOT that it ignores settings (that half is handled by the flag tier).
│       ├─ rev 2: CLI-parity checkbox (default OFF) — "Also apply this style when
│       │   I run `claude` in this project", with the target tier selector and
│       │   the exact file named before it is written (R6, §4.2). A parity write
│       │   failure renders as a non-blocking warning; the selection stays active.
│       └─ footer: "Applies to the next session" + the parity file written, if any (Req 2.5, E2)
│
└─ @if (view() === 'editor')
    └─ OutputStyleEditorComponent     <ptah-output-style-editor />
        ├─ input: draft (null = create), output: saved / cancelled
        ├─ fields: name (required, inline error when blank — Req 3.5),
        │          description (required),
        │          tier radio user|project with a one-sentence explanation each (Req 3.3),
        │          "Keep the default coding instructions" toggle, DEFAULT ON (Req 6.1/6.4),
        │          markdown body textarea
        ├─ toggle helper text switches ON→"added to" / OFF→"replaces" + non-blocking
        │   warning on OFF (Req 6.2/6.3/6.5)
        ├─ NO `force-for-plugin` control (E7)
        └─ preview: <ptah-markdown-block [content]="body()" />
             from '@ptah-extension/markdown' — the ONLY rendering route.
             NEVER [innerHTML]. Precedent: enhanced-prompts-config.component.ts:18,30,190
```

`OutputStyleStore` (`@Injectable({ providedIn: 'root' })`) — shape modelled on `skill-clones-state.service.ts:18-64`:

```ts
private readonly rpc = inject(ClaudeRpcService);
readonly styles   = signal<OutputStyleEntry[]>([]);
readonly invalid  = signal<InvalidOutputStyle[]>([]);
readonly active   = signal<ActiveOutputStyleState | null>(null);
readonly decision = signal<ActivationDecision | null>(null);
readonly loading  = signal(false);
readonly saving   = signal(false);
readonly error    = signal<string | null>(null);
readonly hasCollision = computed(() => …);   // E4
readonly activeMissing = computed(() => this.active()?.missing === true);  // E5
async refresh(): Promise<void>              // outputStyle:list + outputStyle:diagnose
async activate(name: string | null): Promise<void>   // optimistic + rollback on failure
async save(input): Promise<void>            // then refresh() — satisfies Req 3.6
async remove(name, tier): Promise<void>
```

Result handling is the repo's Result-object convention (`result.isSuccess()` / `result.data` / `result.error`), never try/catch-on-throw. Activation uses the optimistic-set-then-rollback pattern of `workflows-config.component.ts:228-250`, which is what makes Req 2.7 ("leave the previous selection intact") free.

**Performance (NFR, <300 ms, non-blocking initial render)**: the store loads in `ngOnInit` of `OutputStyleConfigComponent`, not in `SettingsComponent`. Since the section lives inside the `pro-features` `@if`, it is not even instantiated until the user opens the Advanced tab — the settings panel's initial render is untouched by construction.

---

## 12. Marketplace Constraint (BLOCKING)

**No non-JS file containing a trademarked AI product name may enter the VSIX.** Concrete rules for this task:

1. **Built-in style descriptions live in `libs/backend/output-styles/src/lib/built-in-output-styles.ts`** — a `.ts` file, bundled by esbuild into `main.mjs`. JS bundles are explicitly safe for these names. Descriptions may reference product names there. This is the _only_ sanctioned home for such text in this feature.
2. **No `.md` template or starter-style asset is added anywhere.** If starter styles are ever wanted, they are TS string constants or a runtime download via `ContentDownloadService` — never a VSIX markdown asset.
3. **Test fixtures are inline TS string constants** in `src/lib/__fixtures__/output-style.fixtures.ts`, **not** `.md` files. This removes the question entirely rather than relying on `.vscodeignore` coverage of `libs/**`.
4. **The reference fixture `.claude/output-styles/simplified-technical-english.md` is repo-root working-tree content**, discovered at runtime from the user's project. It is not a VSIX asset and is not moved, copied, or packaged by this task. Its body contains no trademarked product name.
5. **The new `libs/backend/output-styles/CLAUDE.md`** is repo documentation under `libs/`, excluded from the VSIX like every other lib `CLAUDE.md`. Keep its prose free of trademarked names anyway, as belt-and-braces.
6. **UI copy** (Req R1) must describe a style as _influencing_ how the agent writes — never as governing or guaranteeing it. `assembleSystemPrompt` unconditionally appends `PTAH_CORE_SYSTEM_PROMPT` at `:216`, which is the longer and stronger voice; compliance is partial by construction. Do not promise total compliance, and do not weaken the core prompt to chase it (out of scope).

---

## 13. Test Strategy

> **Revised (rev 2):** adds the flag-tier merge spec (G4) and the `resolveSettings()` parity oracle (G3); shrinks the resolver truth table to 8 rows; re-scopes the settings-writer spec from activation to parity.

| Spec (all **CREATE**)                                                                                       | Cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/output-styles/src/lib/output-style-frontmatter.spec.ts`                                       | **Strict rejection names the key**: a file with `theme: dark` yields `{ code: 'UNRECOGNIZED_KEY', key: 'theme' }` and a message listing all four valid keys. **Name-vs-filename (Req 8.2, E1)**: `simplified-technical-english.md` with `name: Simplified Technical English` resolves `name === 'Simplified Technical English'`. **camelCase accepted**: `keepCodingInstructions: true` parses identically to the kebab form. **Serialize emits kebab-case** and round-trips the body byte-for-byte (Req 4.3). **Derived description (Req 1.4)**: no `description` → first body paragraph, single line, ≤160 chars. **Malformed YAML (Req 7.3)** → `{ code: 'YAML_PARSE' }` with `line` when the exception carries a mark. **`keep-coding-instructions` absent → `false`** (matches the binary's assembly semantics). **Fixture (Req 8.4)**: the STE fixture reads `keepCodingInstructions === true`.   |
| `libs/backend/output-styles/src/lib/output-style-slug.spec.ts`                                              | Path separators, `..`, `.`, absolute paths, drive colons, each reserved Windows device name (bare and with `.md`), >64-char truncation, empty-after-slug rejection, unicode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `libs/backend/output-styles/src/lib/output-style-discovery.service.spec.ts`                                 | **Missing-directory discovery (Req 1.5)**: neither `output-styles` dir exists → resolves with the four built-ins, `invalid: []`, no throw. One dir exists → that tier plus built-ins. **Invalid files are listed, not omitted (Req 7.1)**. **Duplicate name across tiers (E4)** → both listed with tier badges, collision flag set, winner matches SDK merge order — **rev 2, now pinned to the verified order**: project beats user beats policy, and any file style beats a same-named built-in. Includes the built-in shadowing case (a user file named `Learning` wins and is flagged as a collision, not silently duplicated). **Active style deleted outside Ptah (E5)** → `active.missing === true` with the orphan name. Non-`.md` files ignored.                                                                                                                                               |
| `libs/backend/output-styles/src/lib/claude-settings.writer.spec.ts`                                         | **Merge-preserving (R2, Req 2.2)**: a pre-existing file with `permissions`, `env`, `hooks` keeps all three byte-identical after the write; only `outputStyle` is added. **Key order preserved** for pre-existing keys. **Missing file/dir (Req 2.3)** → created with only `outputStyle`. **`default`/null (Req 2.4)** → key deleted, siblings intact, empty object emitted rather than the file deleted. **Malformed pre-existing JSON (Req 2.7)** → `SETTINGS_MALFORMED`, **`writeFile` never called** (assert on the mock), message names the workspace-relative path and contains no absolute host path. **Non-object root** → same. **Conflict**: pre-write re-read differs → `SETTINGS_CONFLICT`, no write. **Backup lifecycle**: `.ptah-bak` written before and deleted after success; retained when the write throws. **Tier routing**: local/project/user each resolve the documented filename. |
| `libs/backend/output-styles/src/lib/output-style-activation.resolver.spec.ts`                               | **rev 2. Single-occurrence by construction (R3, Req 5.3)**: the **8-row** `it.each` truth table of §3.4, asserting `inject ⇔ (styleTier === 'user' && isLocalhost)` and that the `flag` branch carries no `body`. **Req 5.1**: project-tier styles never inject, on any provider. **Req 5.2**: user-tier style + `http://127.0.0.1:*` / `http://localhost:*` → `inject`; `https://api.anthropic.com` → `flag`. **Built-ins never inject on any provider (G5)** — `Learning` + localhost → `flag`. **Regex drift guard**: `LOCALHOST_BASE_URL_RE.source` matches the literal in `sdk-query-options-builder.ts:625`.                                                                                                                                                                                                                                                                                      |
| `libs/backend/agent-sdk/src/lib/helpers/assemble-system-prompt.output-style.spec.ts`                        | **Single occurrence in the assembled prompt** — the four cases of §3.4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.output-style.spec.ts` **(rev 2, CREATE)** | **G4 flag-tier merge safety.** `outputStyleName` set → `options.settings` deep-equals `{ autoMemoryEnabled:false, autoDreamEnabled:false, outputStyle:'X' }`. **`PTAH_DISABLE_SDK_AUTO_MEMORY` is not mutated** — deep-equal to a pre-call snapshot, and `Object.keys(...).length === 2`. Two builds with different style names do not contaminate each other. No style active → `options.settings` has **no** `outputStyle` key (`'outputStyle' in settings === false`), so a user's own CLI-chosen style is never clobbered. `outputStyleName` and `outputStyleBody` both set → the defensive assertion throws.                                                                                                                                                                                                                                                                                       |
| `libs/backend/output-styles/src/lib/claude-settings.writer.parity.spec.ts` **(rev 2, CREATE — G3 oracle)**  | Write a fixture `.claude/settings.json` via `ClaudeSettingsWriter`, then call the SDK's `resolveSettings({ cwd, settingSources })` and assert the effective `outputStyle` came from the tier Ptah's UI claimed (`sources[].source`). Proves the parity write is actually visible to the CLI's own merge engine. **Guard with an availability check** (`typeof resolveSettings === 'function'`) and `it.skip` otherwise — the API is `@alpha`.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `libs/backend/rpc-handlers/src/lib/handlers/output-style-rpc.handlers.spec.ts`                              | Every method rejects malformed params with `INVALID_PARAMS` via `RpcUserError`. Traversal / reserved-name payloads rejected before any FS call. No absolute host path and no raw exception text in any surfaced message (Req 7.6). `outputStyle:save` with a changed `name` on the active style updates the settings key in the same call (Req 4.4). `outputStyle:delete` of the active style clears the key and returns `clearedActive: true` (Req 4.6). `METHODS` matches the manifest entry.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`                                                   | **EXISTING — the dual/triple-registration guard.** Will be red until all three registration sites are complete. Do not modify it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `libs/frontend/chat/src/lib/settings/output-style/output-style.store.spec.ts`                               | `refresh()` populates signals from a mocked `ClaudeRpcService`; failed `activate()` rolls back the previous selection and sets `error`; `save()` triggers a refresh so the new style appears without reload (Req 3.6); `activate()` does **not** auto-fire after `save()` (Req 3.7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `libs/frontend/chat/src/lib/settings/output-style/output-style-editor.component.spec.ts`                    | Blank/whitespace `name` blocks submit with an inline error (Req 3.5); the keep-instructions toggle defaults ON (Req 6.4); helper text and the OFF warning switch correctly (Req 6.2/6.3/6.5) — **rev 2: the OFF warning must contain the Ptah-specific qualifier from §4.6 and must not claim the style replaces the agent's behaviour outright**; the CLI-parity checkbox defaults OFF and names its target file before writing; no `force-for-plugin` control exists (E7); the preview uses `ptah-markdown-block` and the template contains no `[innerHTML]`. **Must include the `jest.mock('ngx-markdown', …)` stub block copied from `settings.component.spec.ts:9-37`.**                                                                                                                                                                                                                           |

---

## 14. Sequenced Phases

> **Revised (rev 2):** P4 shrinks and moves onto the critical path's shoulder — it is now the _primary_ activation mechanism (a 3-line flag-tier spread) rather than a fallback-only concern, and the injection half is a small addition to it. P5's deferral is now evidence-backed. A new P4b covers the opt-in parity write.

| Phase                                       | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Depends on | Notes for the team-leader                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 — Contracts**                          | `rpc-output-style.types.ts` (CREATE); `AISessionConfig.outputStyleName` + `outputStyleBody` (EDIT `ai-provider.types.ts`); `tsconfig.base.json` path (EDIT)                                                                                                                                                                                                                                                                                                                     | —          | Pure type work, no runtime. Unblocks everything. Touches two shared files — do this in one small batch and land it fast.                                                                                                                                                                                                                                                           |
| **P1 — Lib core**                           | The whole `libs/backend/output-styles` lib: scaffold, schema, frontmatter, slug, built-ins, discovery, file writer, settings writer, activation resolver + **all five backend specs**                                                                                                                                                                                                                                                                                           | P0         | The bulk of the work and fully self-contained (only new files + the P0 types). Two devs can split cleanly: (a) frontmatter + slug + built-ins + discovery, (b) settings writer + activation resolver. **backend-developer.**                                                                                                                                                       |
| **P2 — RPC surface**                        | Handler + schema + spec (CREATE); `rpc.types.ts` 4 blocks, `rpc-handler.ts` allowlist, `manifest.ts` entry, both `rpc-handlers` barrels, three composition-root `registerOutputStyleServices` calls (EDIT)                                                                                                                                                                                                                                                                      | P1         | **All three registration sites must land in the SAME batch** — `rpc-allowlist.spec.ts` is red otherwise. **backend-developer.**                                                                                                                                                                                                                                                    |
| **P3 — Frontend**                           | Store + 3 components + 2 specs (CREATE); `settings/index.ts`, `settings.component.ts` imports array, `settings.component.html` one tag (EDIT)                                                                                                                                                                                                                                                                                                                                   | P2         | Confined to `settings/output-style/` plus three ≤2-line edits. **Re-`Read` `settings.component.{ts,html}` immediately before editing** — that lib has in-flight work in `app-shell.component.*`. **frontend-developer.**                                                                                                                                                           |
| **P4 — Activation (flag tier + injection)** | **rev 2, now the primary mechanism.** The `settings:` flag-tier spread at `sdk-query-options-builder.ts:600` + the both-fields-set assertion; `assembleSystemPrompt` + `AssembleSystemPromptInput` + `buildSystemPrompt` call; the two `AISessionConfig` literals + ctor inject (EDIT `chat-session.service.ts`); `settings-core` `outputStyle.selectedName` setting; `assemble-system-prompt.output-style.spec.ts` + `sdk-query-options-builder.output-style.spec.ts` (CREATE) | P1         | **Parallelisable with P3** — no frontend dependency. Still small (~10 edited lines across three files) but it is now what makes the feature work at all, so it must land before P3 is demoable. **backend-developer.**                                                                                                                                                             |
| **P4b — CLI parity (opt-in)**               | Wire `ClaudeSettingsWriter` behind the parity flag in `outputStyle:activate`; `claude-settings.writer.parity.spec.ts` (CREATE)                                                                                                                                                                                                                                                                                                                                                  | P2, P4     | **Independently cuttable.** If cut, the feature still works end to end inside Ptah; only cross-tool parity is lost. Cut this before cutting anything else except P5. **backend-developer.**                                                                                                                                                                                        |
| **P5 — Plugin tier (deferrable)**           | `plugin-roots.port.ts` + discovery branch + `plugin.json` `outputStyles` handling (E6); adapter registration in the three roots                                                                                                                                                                                                                                                                                                                                                 | P1         | **Cut this first.** rev 2 evidence: no plugin in the repo ships `output-styles/`, nothing parses `plugin.json`, and `pluginPaths` is only logged rather than passed to the SDK — so plugin styles very likely do not reach a Ptah session at all (G6, UNVERIFIED). If cut, record that Req 1.1/1.3/E6 are structurally satisfied with a stubbed enumerator. **backend-developer.** |
| **P6 — Docs**                               | `libs/backend/output-styles/CLAUDE.md` (CREATE); root `CLAUDE.md` module index (EDIT, +1 line)                                                                                                                                                                                                                                                                                                                                                                                  | P2         | Trivial, batch with P5 or P3.                                                                                                                                                                                                                                                                                                                                                      |

**Critical path**: P0 → P1 → P2 → P3, with **P4 required for the feature to actually function** (it branches off P1 and rejoins at QA). P4b, P5, P6 are leaves; cut order if scope must shrink is **P5 → P4b → P6**.

---

## 15. Requirement → Design Trace

| Req / Edge / Risk                                                                                                | Where satisfied                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 discovery, tiers, badges, derived description, missing dirs, active marker                                    | §5.5, §7, §8, §11; `output-style-discovery.service.spec.ts`                                                                                                                                                                                                                                                                                                                                             |
| R2 choose active, merge-preserving, create-if-absent, `default` clears, next-session copy, error keeps selection | **rev 2 — now split in two.** _Activation_ (2.1 value is the `name`, 2.4 `default` is a no-key, 2.5 next-session, 2.6 exactly once): §3, flag tier, cannot fail. _Parity_ (2.2 merge-preserving, 2.3 create-if-absent, 2.7 readable error): §4.3, `claude-settings.writer.spec.ts` — and 2.7's "leave the previous selection intact" is now free, because a parity failure never touches the selection. |
| R3 create form, strict keys only, tier choice, safe slug, blank-name block, refresh, no auto-activate            | §5.2, §5.6, §11; editor + store specs                                                                                                                                                                                                                                                                                                                                                                   |
| R4 edit/delete, immutability reasons, verbatim body, rename updates key, delete confirm + fallback               | §5.1 (`.replace(/\n$/,'')`), §6 (`save` upsert), §8, §11                                                                                                                                                                                                                                                                                                                                                |
| R5 both paths, exactly once, fallback UI, project-copy escape hatch, per-session re-resolve                      | §3 in full                                                                                                                                                                                                                                                                                                                                                                                              |
| R6 keep-coding-instructions comprehensible, default ON, OFF warning                                              | §11 editor tree; editor spec                                                                                                                                                                                                                                                                                                                                                                            |
| R7 surface validation errors, name the key, YAML line, non-selectable, fixable, sanitised                        | §5.4, §11 list tree; frontmatter + handler specs                                                                                                                                                                                                                                                                                                                                                        |
| R8 reference fixture                                                                                             | frontmatter spec + discovery spec                                                                                                                                                                                                                                                                                                                                                                       |
| E1 name ≠ filename                                                                                               | §5.5 — `name` is the only key used downstream                                                                                                                                                                                                                                                                                                                                                           |
| E2 which settings tier                                                                                           | **rev 2** §4.2 — parity only; project tier default, opt-in, user-selectable, file named in the UI                                                                                                                                                                                                                                                                                                       |
| E3 localhost proxy                                                                                               | **rev 2** §3.1/§3.2 — affects the style _file_ scan only; the key rides the flag tier                                                                                                                                                                                                                                                                                                                   |
| E4 duplicate names                                                                                               | §11 collision banner; discovery spec                                                                                                                                                                                                                                                                                                                                                                    |
| E5 deleted active style                                                                                          | §11 missing banner; `outputStyle:diagnose`                                                                                                                                                                                                                                                                                                                                                              |
| E6 plugin `outputStyles` override                                                                                | §7                                                                                                                                                                                                                                                                                                                                                                                                      |
| E7 `force-for-plugin` hidden                                                                                     | §11 editor tree; editor spec                                                                                                                                                                                                                                                                                                                                                                            |
| E8 concurrent edit                                                                                               | `stat().mtime` (`platform.types.ts:41`) captured on `get`, echoed on `save`, re-checked before write. **Known gap**: the shared FS contract suite (`run-file-system-contract.ts:70-85`) asserts only `type` and `size` on `stat`, so `mtime` is not cross-adapter-guaranteed — belt-and-braces, also compare byte length.                                                                               |
| R1 (partial compliance)                                                                                          | §12.6 — a copy/expectations rule, not an engineering one                                                                                                                                                                                                                                                                                                                                                |
| R2 (settings clobber)                                                                                            | **rev 2** §4.3 steps 4–10, and blast radius reduced further because the write is now opt-in and non-load-bearing                                                                                                                                                                                                                                                                                        |
| R3 (double application)                                                                                          | **rev 2** §3 — complements of one boolean, one call site, 8-row truth table; risk downgraded because the key half is no longer a variable                                                                                                                                                                                                                                                               |
| R4 (schema drift)                                                                                                | §5.2 — one named location, version pin, upgrade-checkpoint comment                                                                                                                                                                                                                                                                                                                                      |
| R5 (accidental disable)                                                                                          | **rev 2** §4.6 + §11 — default ON, labelled, warned, and the warning is now accurate about Ptah's milder effect                                                                                                                                                                                                                                                                                         |
| R6 (tier confusion)                                                                                              | **rev 2** §4.2 — parity is opt-in and default OFF, so no settings file is written unless the user asks; UI names the file                                                                                                                                                                                                                                                                               |
| G7 (no custom turn reminder)                                                                                     | §4.5 — stated so the UI never promises per-turn reinforcement                                                                                                                                                                                                                                                                                                                                           |

---

## 16. Verification Points Before Implementation

The developer must confirm each of these exists before writing code that depends on it:

1. `IFileSystemProvider` members used: `readFile`, `writeFile`, `exists`, `readDirectory`, `stat`, `delete` — `libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts:22,34,46,52,58,64`. Note the names are `readDirectory` and `createDirectory` (not `readDir`/`mkdir`), and there is **no `rename`**.
2. `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` (`di/tokens.ts:13`), `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (`:25`).
3. `IWorkspaceProvider.getWorkspaceRoot(): string | undefined` — **synchronous, may be undefined**; handle no-workspace (`workspace-provider.interface.ts:24`).
4. `RpcUserError` and the `parse`/`sanitize` helper shape — `tasks-rpc.handlers.ts:986-1021`.
5. `ALLOWED_METHOD_PREFIXES` entries end with a **colon** — `rpc-handler.ts:40`.
6. `MarkdownBlockComponent`, selector `ptah-markdown-block`, `content = input.required<string>()` — `libs/frontend/markdown/src/lib/markdown-block.component.ts:23,30`; import from `@ptah-extension/markdown`.
7. `ClaudeRpcService.call<T>(method, params, options?)` returns a **Result object**, not a throw — `libs/frontend/core/src/lib/services/claude-rpc.service.ts:130-134`.
8. `ProviderProfile.baseUrl` — `libs/shared/src/lib/types/provider-profile.types.ts:14`, already resolved at `chat-session.service.ts:425-429`.
9. `gray-matter` needs a per-call options object — `task-frontmatter.ts:79-103`.
10. There is **no home-directory port**; `homedir()`-with-override is the sanctioned idiom (`file-settings-manager.ts:68-69`), and `node:path` is used directly throughout backend libs (193 files) — path _computation_ is not port-mediated, only path _I/O_ is.
11. **rev 2**: `Options.settings` accepts an inline object (`sdk.d.ts:1726`, `settings?: string | Settings`), and `outputStyle` is a `Settings` member (`sdk.d.ts:5037`). `PTAH_DISABLE_SDK_AUTO_MEMORY` is a shared module-level object (`constants.ts:24`) passed by reference at `sdk-query-options-builder.ts:600` — **never mutate it**.

---

## 17. Rev 2 — Gap Closure

All evidence below was extracted from the shipped binary at `node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` (SDK v0.3.150) via `tr -d '\000' < claude.exe | grep -a -o '<pattern>'`, or read from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.

| #       | Gap                                                                                   | Verified answer                                                                                                                                                                            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                               | Design change                                                                                                                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1**  | Does flag-tier `outputStyle` actually activate a style?                               | **YES.** The flag tier is unconditionally enabled and outranks user/project/local.                                                                                                         | `function km(){ let H=wK8(); … let q=new Set(H); q.add("flagSettings"); q.add("policySettings"); return BW.filter(($)=>q.has($)) }` and `BW=["userSettings","projectSettings","localSettings","flagSettings","policySettings"]` (low→high). `settings?: string \| Settings` at `sdk.d.ts:1726`; `outputStyle` on `Settings` at `sdk.d.ts:5037`; `'flag'` tier at `sdk.d.ts:2388`. Ptah already uses the channel at `sdk-query-options-builder.ts:600`. | **Activation moved to the flag tier.** The settings.json write is no longer the mechanism (§3.1, §3.3a).                                                                                                                                                                                                                      |
| **G2**  | _Determining question._ Is output-style **file** discovery gated by `settingSources`? | **YES — it is gated.** `HU` skips the user directory entirely when `'user'` is absent. Managed/policy is always scanned; user and project are conditional.                                 | `HU=v6(async function(H,q){ … i3("userSettings") ? sQq($).then(…source:"userSettings") : Promise.resolve([]), i3("projectSettings") ? Promise.all(f.map(…)) : Promise.resolve([]) …})` with `function i3(H){return km().includes(H)}`                                                                                                                                                                                                                  | **Fallback survives, narrowed to one axis.** `keyVisible` deleted; `inject === !fileVisible`, true only for _user-tier file × localhost_. Truth table 30 rows → 8 (§3.2, §3.4).                                                                                                                                               |
| **G3**  | Adopt `resolveSettings()`?                                                            | **Runtime: NO. Tests: YES.** It resolves the _settings_ cascade, not the style-_file_ cascade, and is `@alpha` with documented divergences.                                                | `sdk.d.ts:2414` + caveats at `:2395-2411`; `ResolveSettingsOptions{cwd, settingSources}` at `:2420-2431`; `sources[].source` at `:2373-2378`                                                                                                                                                                                                                                                                                                           | Rejected for discovery; adopted as the oracle in `claude-settings.writer.parity.spec.ts`, guarded by an availability check (§4.4, §13).                                                                                                                                                                                       |
| **G4**  | Merge safety into `PTAH_DISABLE_SDK_AUTO_MEMORY`                                      | Shared object passed **by reference** on every query — mutation would leak across sessions.                                                                                                | `constants.ts:24-27`; `settings: PTAH_DISABLE_SDK_AUTO_MEMORY` at `sdk-query-options-builder.ts:600`                                                                                                                                                                                                                                                                                                                                                   | Fresh spread per session at the call site; three-part spec (auto-memory keys survive, constant unmutated, key **absent** when no style is active so a user's own CLI choice is not clobbered). `Object.freeze` recommended (§3.3a).                                                                                           |
| **G5**  | Do built-ins activate through the flag tier?                                          | **YES**, and they can never be hidden — they come from a hardcoded map, not a directory scan.                                                                                              | Registry seeded from `Object.values(CwH)` before merging discovered files; `Explanatory:{name:"Explanatory",source:"built-in",description:"…",keepCodingInstructions:!0,prompt:…}`                                                                                                                                                                                                                                                                     | **`'inert'` branch deleted** from `ActivationDecision` as unreachable dead state (§3.2, §8).                                                                                                                                                                                                                                  |
| **G5b** | _(derived)_ SDK merge order for duplicate names                                       | `_[M.name]=…` over `[...policy, ...user, ...project]`, last write wins.                                                                                                                    | Same registry assembly string                                                                                                                                                                                                                                                                                                                                                                                                                          | E4 winner rule pinned: **project > user > policy, and any file style shadows a same-named built-in**. Built-in shadowing added as a discovery spec case (§8, §13).                                                                                                                                                            |
| **G6**  | Is `${plugin}:${style}` accepted as an `outputStyle` value?                           | **PARTIALLY VERIFIED.** The identifier is valid by construction; whether plugin styles load _in a Ptah session_ is **UNVERIFIED**.                                                         | `` O=`${q}:${Y}` `` and `{name:O,…,source:"plugin"}` in `oA4`; lookup is `return H[_]??null`. But `pluginPaths` is only _logged_ (`sdk-query-options-builder.ts:584`), and `skill-junction.service.ts:8-10` records that the SDK's `plugins` option "does NOT reliably load skills".                                                                                                                                                                   | **Would be verified by** a live session with a plugin shipping `output-styles/` — none exists in this repo. Designed defensively: read-only listing, not activatable by Ptah, never written to a settings file. **P5 stays deferred, now on evidence.**                                                                       |
| **G7**  | `turnReminder` provenance                                                             | **Built-in only.** A custom style can never carry one; it gets a generic fallback sentence.                                                                                                | `[{type:"output_style",style:q,turnReminder:K?.turnReminder}]`; renderer `turnReminder??"Remember to follow the specific guidelines for this style."`; the field appears inline in the `CwH` built-in definitions. The `.strict()` schema has no `turn-reminder` key.                                                                                                                                                                                  | New §4.5. UI must not promise style-specific per-turn reinforcement, and no form field for it (a fifth key would void the file).                                                                                                                                                                                              |
| **G8**  | What `keep-coding-instructions: false` means inside Ptah                              | **Materially milder than the CLI.** The SDK section is dropped identically, but `PTAH_CORE_SYSTEM_PROMPT` is still appended unconditionally, so Ptah's own behaviour prompt still governs. | `appendParts.push(PTAH_CORE_SYSTEM_PROMPT)` unconditional at `sdk-query-options-builder.ts:216`; binary assembly `(style===null\|\|style.keepCodingInstructions===true)?codingInstructions():null`                                                                                                                                                                                                                                                     | New §4.6 with a side-by-side table and **required Req 6.3 copy change** — the OFF warning must state the Ptah-specific, smaller effect rather than the general one. Asserted in the editor spec.                                                                                                                              |
| **G9**  | Keep the settings.json write?                                                         | **Keep, re-scoped.** It is now optional CLI parity, not activation — which was the user's stated value proposition.                                                                        | User request in `context.md`; parity claim in `task-description.md` (value proposition, stakeholder table row "Power users / CLI users")                                                                                                                                                                                                                                                                                                               | §4 rewritten: activation vs parity table; **default flipped from local tier to project tier** (the committable tier is the one that serves parity), and the whole write made **opt-in, default OFF**, which also retires R6 as a default-path risk. Writer and its spec unchanged. New phase **P4b**, independently cuttable. |

### Net effect of rev 2

- **One requirement got easier**: Req 2.7 ("write failure leaves the previous selection intact") is now structural — a parity failure cannot affect a selection that never depended on it.
- **One risk downgraded**: R3 loses an entire axis; the truth table shrinks 30 → 8.
- **One risk retired on the default path**: R6 — no settings file is written at all unless the user opts in.
- **One risk newly surfaced and handled**: the flag tier _outranks_ the user's own `settings.json`, so Ptah must send no `outputStyle` key when no style is chosen. Covered by a spec case (§3.3a).
- **Two copy accuracy fixes**: G7 (no custom turn reminder) and G8 (OFF warning overstates the effect in Ptah).
- **Nothing survives that shouldn't**: `'inert'` and `keyTier` are removed rather than left as dead state.

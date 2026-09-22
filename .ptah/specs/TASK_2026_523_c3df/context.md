# Context

## How this started

A skill enhancement of `agent-lanes` silently did nothing. The log
(`%APPDATA%/Ptah/logs/Ptah Electron-2026-09-22.log`) showed:

```
605: [WARN] [skill-enhancer] candidate generation failed: {"slug":"agent-lanes","error":"Operation aborted"}
606: [WARN] [RPC] slow handler: {"method":"skillSynthesis:previewEnhancement","durationMs":37311.3}
```

`ENHANCE_TIMEOUT_MS = 30_000` (`skill-enhancer.service.ts:61`) aborted a full
`SKILL.md` rewrite. Nothing was written — proven by the clone sidecar
(`lastEnhancedAt: null`, `currentContentHash === sourceHash`).

Chasing it surfaced three larger problems the user then scoped as this task.

## Problem 1 — `authMethod` is an internal strategy enum pretending to be a user setting

`~/.ptah/settings.json` holds `"authMethod": "apiKey"`. The user authenticates
through the Claude CLI subscription. Both statements are true at once, because
there are two unrelated axes named "provider":

| Axis | Key | This install's value |
| --- | --- | --- |
| Main-agent auth strategy | `authMethod` | `apiKey` |
| Ptah CLI agent lanes | `ptahCliAgents[]` | `claude cli` → `providerId: claude-cli`, provider `Claude (Subscription)`, enabled |

`ptah_agent_list` reports `claude cli | ptah-cli | available | provider: Claude
(Subscription)`. The user reads that as "I am on the Claude CLI". The main agent
disagrees, and the SDK says so on every internal query:

```
claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth
source is set and takes precedence over your claude.ai login
```

Three defects compound:

1. **`apiKey` is the shipped DEFAULT** (`AUTH_METHOD_DEF.default`,
   `normalizeAuthMethod`'s fallback). There is no "not configured" state, so a
   user who never opened the auth screen still reads as "API key" to every
   consumer — including `resolveJudgeModel`. The repo already forbids exactly
   this shape elsewhere: "never coalesce `NULL` to `''` — that turns *we do not
   know* into a claim" (`skill-synthesis/CLAUDE.md`, on `workspace_root` and
   `judge_score`). `authMethod` has no such null.
2. **`activeProviderId` cannot distinguish the two.**
   `ActiveProviderResolver.resolveActiveAuth` returns `ANTHROPIC_DIRECT_PROVIDER_ID`
   for `apiKey` **and** `claudeCli` (`active-provider-resolver.ts:30-32`), so the
   logged `activeProviderId: "anthropic"` is not evidence of either.
3. **The truthful answer already exists and the UI never asks for it.**
   `resolveEffectiveAuthRoute` (`auth-providers/src/lib/auth/effective-route.ts`)
   is documented as the single source of truth for *"what would happen if I ran
   an agent right now?"*, returning `{route, ready, blockers[]}`. Its own docblock
   names "the future Electron settings panel" as a planned caller. Actual callers
   today: `apps/ptah-cli/src/cli/commands/doctor.ts` and `init.ts`. **Nothing in
   the webview calls it, and no `auth:getEffectiveRoute` RPC exists.**

## Problem 2 — provider and model choices are scattered across five surfaces

| Concern | Key(s) | Default | Where it is set | Control shape |
| --- | --- | --- | --- | --- |
| Main agent auth | `authMethod`, `anthropicProviderId`, `provider.<authKey>.selectedModel` | `apiKey` | Settings → Auth (`auth-config.component.ts`, 525 lines) | strategy radio + key form |
| CLI agent lanes | `ptahCliAgents[]`, `agentOrchestration.*Model` | — | Settings → Ptah AI (`ptah-cli-config.component.ts`, 1097 lines) | separate list editor |
| Memory curator | `memory.curatorProvider` + `memory.curatorModel` | `''` + `''` | Memory tab → diagnostics accordion | `ProviderModelPickerComponent` |
| Skill lanes (×4) | `skillSynthesis.<lane>.provider` + `.model` | `''` | Skills tab → Settings → Lanes | `ProviderModelPickerComponent` ×4 |
| **Skill/agent/command ENHANCEMENT** | `skillSynthesis.judgeModel` | `'inherit'` | Skills tab → Settings → Judging | **free-text `<input>`** |

The last row is the trap that produced the original failure report.
`SkillEnhancerService.generateCandidate` is **not a lane** — `skill-synthesis/CLAUDE.md`
states it explicitly — so the four lane pickers do not govern "Enhance now".
Only the free-text box does, and its label reads `Judge model ('inherit' =
workspace default)`. Nothing connects the words "judge" and "enhance".

`skill-settings-panel.component.ts:4` claims "THIS IS THE ONE SOURCE OF TRUTH for
skill-synthesis settings". It is not — the memory curator's equivalent lives in
another tab under another shape.

## Problem 3 — config scope is invisible

`WorkspaceScopeResolver` supports `app` / `global` / `workspace` scoping and the
RPC surface already exposes `auth:getScope` and `auth:clearWorkspaceOverride`.
The settings UI barely shows which scope a value came from, so a per-workspace
override is indistinguishable from a global one until behaviour diverges.

This install has no workspace override for `D:\projects\ptah-extension`; the
`apiKey` value is global. Nothing in the UI made that legible.

## What the user asked for

1. Settings must represent the authentication **actually in use**, not a stored enum.
2. Every provider/model choice moves to **one place**.
3. Auth-providers UI/UX: vendor marks sourced from `https://thesvg.org/`, a real
   guided setup wizard per provider, and an appealing display of *connected*
   providers versus the *active* one.
4. Global versus per-workspace scope must be far more visible.
5. Plus the three carried-over fixes:
   - raise / expose `ENHANCE_TIMEOUT_MS`;
   - replace the free-text judge-model input with `ProviderModelPickerComponent`
     and relabel it to say it governs judging **and** enhancement;
   - surface the memory-curator model in the same consolidated place.

## Constraints that bound any design

- `ProviderModelPickerComponent` (`libs/frontend/ui`) already exists and is the
  reuse target — do not mint a second picker.
- Adding a second place a provider can be pinned is the failure mode
  `skill-settings-panel.component.ts:4` was written to prevent. Consolidation
  must **remove** surfaces, not add a sixth.
- `libs/frontend/**` must not import `libs/backend/**`. `libs/shared` is the bridge.
- Three tier-env writers exist and must stay in lockstep
  (`auth-providers/CLAUDE.md`, "FOUR sites populate or read the tier vars").
  A new settings surface must not become a fourth writer with its own chain.
- Any new RPC namespace needs BOTH `libs/shared/.../rpc.types.ts` and
  `ALLOWED_METHOD_PREFIXES` in `vscode-core/.../rpc-handler.ts:46`.
- Vendor SVG licensing must be checked before anything is vendored into the repo.
- `authMethod` is persisted in existing installs. Any re-modelling needs a
  read-compatible migration; `normalizeAuthMethod` already accepts legacy and
  new spellings and is the seam.

## Decisions taken by the user (2026-09-22)

### D1 — Vendor marks: allowlist the permissive vendors only

`research-report.md` established two independent blockers. First, theSVG's MIT
licence covers its wrapper code and explicitly **not** the marks: *"theSVG does
not grant trademark rights — those remain with the brand owner"* (`LEGAL.md`).
Second, three vendors in the registry publish written prohibitions on
third-party product-UI logo use — OpenAI (`openai.com/brand`),
GitHub/Microsoft (`brand.github.com`, which retired the standalone Copilot
icon in 2025) and Google (`about.google/brand-resource-center`).

**Decision**: ship real inlined marks ONLY for vendors that publish integrator
assets or carry minimal trademark exposure — `openrouter`, `ollama`,
`ollama-cloud`, `opencode`, `pi`, plus Ptah's own mark. Every other provider
renders a styled `lucide-angular` glyph beside its wordmark.

Rejected: inlining all eleven under nominative fair use. Defensible in
principle, but three vendors have said no in writing, and a uniform generic
treatment for the restricted set reads as deliberate rather than patchy.

**The allowlist is a data table, not a branch.** One record per provider id
carrying either an inlined path or a lucide fallback name, so adding a mark
later (if a vendor grants permission) is a one-line edit and never a component
change.

### D2 — Delivery mechanism is forced, not chosen

Loose `.svg` files may NOT ship. `CLAUDE.md:180-189`: the marketplace scanner
rejects trademarked AI product names in non-JS files, and *"once an extension ID
fails marketplace validation, that ID is permanently burned."* A path like
`assets/icons/openai.svg` carries the token in the FILE PATH before the XML is
even read.

**Decision**: sanitized path data as TypeScript constants compiled into the
webview bundle (JS bundles pass the scanner), rendered by one presentational
component. No loose asset files. No runtime download — rejected as network
fragility for a 24 px icon when inlining costs nothing.

Sanitization is mandatory on every inlined mark: strip `<title>`, `<desc>`,
comments, metadata and any class or id containing a trademarked token. Render
monochrome via `currentColor` at 24 px.

**Open verification (from `research-report.md` "Unknowns")**: nobody outside
Microsoft has the scanner's regexes. Before release, run `vsce package` then
`vsce ls` and assert zero non-JS files in the archive carry a flagged token.
Do this against a THROWAWAY extension id, never the shipping one.

### V1 — Orchestrator verification: `authMethod` absence is indistinguishable on ALL THREE hosts

`implementation-plan.md` Risk 5 flagged a gap: its Decision 1 rests on the claim
that a physically absent `authMethod` cannot be told apart from a stored one,
and the architect verified that on Electron only, explicitly marking VS Code and
CLI as **assumed**. That gap is now **closed by direct reading, and the claim
holds on all three.**

| Host | `readGlobal` implementation | Path taken for `authMethod` |
| --- | --- | --- |
| Electron | `platform-electron/src/settings/file-settings-store.ts:36-38` | `fileSettings.get(key)` |
| CLI | `platform-cli/src/settings/file-settings-store.ts:42-44` | `fileSettings.get(key)` — unconditional |
| VS Code | `platform-vscode/src/settings/vscode-settings-adapter.ts:70-75` | branches on `isFileBasedSettingKey(key)`; `authMethod` IS in `FILE_BASED_SETTINGS_KEYS` (`file-settings-keys.ts:155`), so it takes `:72` → `fileSettings.get(key)` |

All three converge on `PtahFileSettingsManager.get`, which returns the registered
default `'apiKey'` (`file-settings-keys.ts:442`) for an absent key. There is no
host on which raw absence survives to a consumer.

**Consequence**: Decision 1 stands on verified ground rather than on an
Electron-only sample, and Decision 2 (do not remove the store default in this
task) is strengthened — the default is load-bearing in three hosts, not one.
Treat `implementation-plan.md` Risk 5 as RESOLVED; do not re-open it, and do not
spend a batch re-verifying it.

### D3 — Consolidation lands in one task, old surfaces deleted with it

**Decision**: build `Settings → Providers` and remove all eight existing entry
points in the same task.

The alternative — new page first, deletions later — recreates precisely the
state `skill-settings-panel.component.ts:4` exists to prevent: *"two copies of a
lane picker means two places a provider can be pinned and one of them silently
losing."* A staged rollout would need the old surfaces forced read-only in the
interim, which is most of the deletion work anyway, done twice.

Consequence for batching: the batch that mounts the new page and the batch that
deletes an old surface touch disjoint files but must land in the same PR. No
intermediate commit may leave two writable editors for the same key.

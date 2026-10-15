## Frontend implementation — `TASK_2026_677_efcd`, batch C-1

**Verdict**: COMPLETE. Task C-1.1 is implemented. The scoped typecheck, lint and test runs pass for
`@ptah-extension/chat-ui` and `@ptah-extension/ui`.

**Tasks completed**: C-1.1, which creates the `ptah-agent-avatar` vocabulary and the ui monogram helpers.

**Files**:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat-ui\src\lib\atoms\agent-avatar\agent-avatar.types.ts`: `AgentStatusWord`, `AgentKind`, `AGENT_KIND_LABEL`, `AgentAvatarSize`, `AgentLabelParts`, `agentAccessibleLabel`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat-ui\src\lib\atoms\agent-avatar\agent-status.ts`: the four `*StatusWord` mappers. Each switch is exhaustive and ends in a `never` default.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat-ui\src\lib\atoms\agent-avatar\agent-duration.ts`: `formatAgentDuration`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat-ui\src\lib\atoms\agent-avatar\agent-marks.ts`: `CLI_PROVIDER_MARK_IDS` (`Record<CliType, string>`), `CliMark`, `cliMarkFor`, `AGENT_ROLE_ICONS` (14 rows), `roleIconFor`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat-ui\src\lib\atoms\agent-avatar\agent-avatar.component.ts`: `AgentAvatarComponent` (`ptah-agent-avatar`)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat-ui\src\index.ts`: one block of export lines added at the end. No other line changed.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\ui\src\lib\native\monogram-tile\index.ts`: `monogramGlyph` and `monogramTintClass` added to the existing `export { ... }`. The barrel still imports only `monogram-tile.component`.

**Evidence per requirement**:

- **Contract C1 inputs** (plan:58-67): `kind = input.required<AgentKind>()`, `status = input<AgentStatusWord | null>(null)`, `size = input<AgentAvatarSize>(28)`, `cliId = input<string | null>(null)`, `agentType = input<string | null>(null)`.
  - The component has no outputs. It is standalone, OnPush, and imports `LucideAngularModule` and `ProviderMarkComponent`.
  - Host: `{ 'aria-hidden': 'true', class: 'relative inline-flex shrink-0', [attr.data-kind], [attr.data-status] }`. The two data attributes are test and styling hooks for the C-3, A1 and B specs.
- **Glyph** (Decision D-C-1): `orchestrator` always renders lucide `Workflow`.
  - `subagent` and `background` render `roleIconFor(agentType)`.
  - `cli` renders `cliMarkFor(cliId)`:
    - `provider` becomes `<ptah-provider-mark [providerId] [size]>`, with size `sm` for 24 and 28 and `md` for 32. No new provider-mark input was added.
    - `monogram` becomes a circle-filling span with `monogramGlyph(label)` and `monogramTintClass(label)`, taken from `@ptah-extension/ui`.
  - Lucide glyph sizes are 14, 16 and 18 px for tile sizes 24, 28 and 32.
- **Tile**: `rounded-full border bg-surface-2 text-base-content`. The border is `border-[var(--surface-border-strong)]`; the Orchestrator gets `border-secondary` instead (gold hairline).
  - Both tokens exist: `--surface-border-strong` at `apps/ptah-extension-webview/src/styles.css:135`, and `surface-2` and `state-*` at `tailwind.config.js:32-41`.
- **Ring**: an absolutely positioned SVG, `(size + 8)` px square at `-left-1 -top-1`, so it sits 4 px outside the tile. Stroke is 2 px. Ink is `text-state-run`, `-need` or `-err`.
  - `running`: a track at 0.28 stroke-opacity plus a `pathLength=100`, `dasharray 30 70` arc. It rotates 1.1 s linear with `transform: rotate` only.
  - `waiting`: a solid ring plus a halo span that runs 1.8 s on `opacity` and `transform: scale` only.
  - `failed`: a solid ring.
  - `done`, `stopped`, `queued` and `null`: no ring.
- **Badge**: 11, 13 or 15 px, `bg-surface-0`, a 1.5 px ink border, and a glyph in the same ink.
  - `running` `LoaderCircle`, `done` `Check`, `failed` `CircleAlert`, `waiting` `Hand`, `stopped` `CirclePause`.
  - `queued` and `null`: no badge.
- **Reduced motion**: under `@media (prefers-reduced-motion: reduce)` the spin and halo animations are `none`. The halo's base opacity is 0, so it disappears; the static 30% arc stays. `:host, :host *` get `transition-duration: 0ms`.
- **No status word in any avatar view**: the avatar renders no text except the monogram letter. `AgentStatusWord` has no `error` member, and no `Needs you` string exists in these files.
- **One table each**: `CLI_PROVIDER_MARK_IDS` is the only `cliId -> providerId` table. `AGENT_ROLE_ICONS` is the only role-icon table. Lookups use an own-property check (`Object.hasOwn`), and keys are trimmed.
- **Monogram helpers**: exported from the `monogram-tile` barrel. They reach `@ptah-extension/ui` through the existing `export * from './monogram-tile'` in `native/index.ts:43`, so `native/index.ts` is unchanged (R7 barrel rule).
- **Barrel exports** (acceptance), all from `@ptah-extension/chat-ui`:
  - Component: `AgentAvatarComponent`
  - Constants: `AGENT_KIND_LABEL`, `CLI_PROVIDER_MARK_IDS`
  - Functions: `agentAccessibleLabel`, `cliLaneStatusWord`, `subagentStatusWord`, `backgroundAgentStatusWord`, `orchestratorStatusWord`, `formatAgentDuration`, `cliMarkFor`, `roleIconFor`
  - Types: `AgentAvatarSize`, `AgentKind`, `AgentLabelParts`, `AgentStatusWord`, `CliMark`

**Stack observed**:

- Angular 22.1.7 (`package.json:97`), written in the standalone, OnPush, `input()` and `computed()` style of `libs/frontend/chat-ui/src/lib/atoms/copy-button.component.ts` and `libs/frontend/ui/src/lib/native/brand-mark/monogram-tile.component.ts`.
- `lucide-angular` ^1.0.0. Icons are imported by name. The type is `LucideIconData`, exported from the package root, the same import `setting-scope-row.component.ts:10` uses.
- Tailwind with the repository's tokens: `apps/ptah-extension-webview/tailwind.config.js` and `src/styles.css`.

**Design fidelity**: plan-part-c §1 (C:121-224), §3 (C:293-304) and implementation-plan.md:58-71 were followed. There are no deviations in visuals or API.

**States covered**: all six status words and `null`, all four kinds, and three sizes. The CLI cases are: a known id (provider mark), an unknown id (monogram of the id), and an empty or null id (the `CLI lane` monogram, `C`). The avatar is decorative (`aria-hidden`). The accessible name comes from `agentAccessibleLabel`.

**Validation notes and edge cases**:

- `formatAgentDuration(ms)`: a non-finite or negative value, or anything under 1000 ms, returns `null`.
  - Under 60 s it returns `{s}s`. Under 1 h it returns `{m}m {ss}s`. From 1 h it returns `{h}h {mm}m`. Seconds are floored, and minute and second fields are zero-padded.
  - A1 and A1-2 depend on the `null` result to show `Worked` or `Working`.
- An unknown `agentType` (or null or blank) returns `Bot` from `roleIconFor`.
- An unknown `cliId` returns a monogram of that id, never `Bot`. A null or blank id returns the `CLI lane` monogram, so the tile is never blank.
- `agentAccessibleLabel` builds `{name}, {kind}, {status} {duration}` and drops each absent part with its separator. The kind is omitted for the Orchestrator, so `Orchestrator, running` stays clean. The duration goes through `formatAgentDuration`, so under 1 s it is dropped.
- `orchestratorStatusWord` returns `null` for `fresh` and `draft`, which draws the tile only. An open request returns `waiting` in all mappers.
- `cliLaneStatusWord` returns `waiting` when `openRequests > 0`.

**Risks carried (batches.md Plan validation)**:

- Shared worktree with B-1 and B-2: I touched only the 7 batch files. `git status` for `libs/frontend/chat-ui` and `libs/frontend/ui` shows only these files.
- Shared `chat-ui` barrel (C-1 is the first owner, append-only): the export lines are appended at the end of `libs/frontend/chat-ui/src/index.ts`, after `toolStatusPresentation`, under a C1 comment. No existing line changed. A1-1 and A2-2 append after this block.
- Eager bundle headroom (HIGH, measured by BUILD-1): the batch adds no runtime edge.
  - The status mappers use only `import type` (`shared`, `chat-streaming`, `chat-types`), so they are erased at build time.
  - Icons are imported by name, about 20 lucide icons, tree-shaken until a consumer renders the avatar.
  - The monogram helpers come from an artwork-free module.
- chat-ui boundary spec: the avatar imports `ProviderMarkComponent` and the monogram helpers from `@ptah-extension/ui`, never `BrandMarkComponent` or the artwork modules. The chat-ui test suite, `dependency-boundaries.spec.ts` included, passes.

**Verification** (from the worktree root, one at a time, through the lock):

- `node .ptah/tmp/check-run.mjs c1-typecheck -- npx nx run-many -t typecheck -p @ptah-extension/chat-ui @ptah-extension/ui --parallel=1 --skip-nx-cache`
  - Result: `exit 0` — `Successfully ran target typecheck for 2 projects`
- `node .ptah/tmp/check-run.mjs c1-lint -- npx nx run-many -t lint -p @ptah-extension/chat-ui @ptah-extension/ui --parallel=1 --skip-nx-cache`
  - First run: `exit 1`. There were 6 `@angular-eslint/template/no-duplicate-attributes` errors in `agent-avatar.component.ts`, from a static `class` next to `[class]`.
  - Fix: I folded the static classes into the `ringClass`, `haloClass` and `badgeClass` computeds.
  - Re-run: `exit 0` — `Successfully ran target lint for 2 projects`
- `node .ptah/tmp/check-run.mjs c1-test -- npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/ui --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - Header: `Running target test for 2 projects: @ptah-extension/chat-ui, @ptah-extension/ui`
  - Result: `exit 0` — `√ nx run @ptah-extension/ui:test`, `√ nx run @ptah-extension/chat-ui:test`, `Successfully ran target test for 2 projects`
- Prettier `--write` was run on the 7 files.
- Not run: build, serve and e2e are not applicable under the executor rules.
- No new spec files, as the batch rules require. The pure functions and the component are observed through later consumer specs (the C-3 dock spec and the A1 and B specs), per C §1 "Verification seam".

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| At runtime, an unknown CLI, sub-agent or background status maps to `stopped`; an unknown Orchestrator status maps to `null`. Compile time still fails through `const _unhandled: never` | throw; `queued`; `stopped` | The repository's pattern in `chat-ui/.../plan-limits/lane-tiles.ts:443-453` never throws from a view-model mapper (a desynced backend must not blank the view). `stopped` is the neutral, non-active word: it never claims running or failed | yes, one line per mapper |
| `agentAccessibleLabel` lives in `agent-avatar.types.ts` | its own file | C:217-218 explicitly allows it there, and the batch file list is fixed | yes |
| `cliMarkFor` and `roleIconFor` trim the key and also accept `undefined` | `string \| null` only | `SubagentRecord.agentType?` is optional (row 9), so callers pass `undefined` without a coercion; a blank id is treated like a missing one | yes |
| Extra public types `AgentLabelParts` and `CliMark` are exported | inline anonymous types | They name the parameter and return types of two exported functions, so consumers can type their own values | yes |
| The `running` badge glyph `LoaderCircle` is static, not spinning | spin it as well | The plan names only the ring as animated. One infinite animation per avatar keeps runtime cost low | yes |

**Plan deviations**: none.

**Out-of-scope observations**: `ptah_get_diagnostics` reported type errors in files outside this batch: `streaming-quotes.component.spec.ts:22`, `compact-session-activity.component.spec.ts:1339,1375`, `compact-session-metrics.spec.ts:57`, `core/src/testing/mock-rpc-service.ts:53-68` and `shared/.../capability-id-codec.ts:262-263`. They come from the diagnostics tool's own compiler settings: the Nx typecheck and test targets for chat-ui and ui both pass. I did not touch them.

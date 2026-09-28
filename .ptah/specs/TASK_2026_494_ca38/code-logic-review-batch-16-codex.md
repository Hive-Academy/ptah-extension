# Batch 16 independent logic review

Score: 10/10

Verdict: APPROVED

Reviewed the five Batch 16 files, their uncommitted diffs (the new guard was read directly), the requested plan sections, coordinator rulings, and batch report. Batch 20 changes are outside this review. No source, spec, or configuration was edited.

## Checks

Paths abbreviated below: `app/` = `apps/ptah-extension-webview/src/app/`; `types/` = `libs/shared/src/lib/types/`; `core/` = `libs/frontend/core/src/lib/`.

| Check | Ruling and file:line evidence |
| --- | --- |
| 1. Guard timing and host flag | PASS. `app/electron-only-surface.guard.ts:19` reads `inject(VSCodeService).isElectron` on each match. `app/app.routes.ts:162` installs it as `canMatch`, ahead of the lazy loader at `:166`. The spec installs a call-through loader spy before Router injection (`app/webview-routing.spec.ts:378`), asserts zero calls on refused navigation (`:395`, `:410`), and asserts one call on Electron (`:465`, `:479`), making the refusal checks non-vacuous. `core/services/vscode.service.ts:172` uses strict `=== true`, so absent/undefined flags refuse. See the initialization qualification below. |
| 2. Refusal fallback and visible state | PASS. The wildcard redirects to chat (`app/app.routes.ts:173`), whose route is unguarded (`:72`), so the fallback cannot loop through apps. Initial-view and real SWITCH_VIEW message tests assert `/chat` and `currentView() === 'chat'` (`app/webview-routing.spec.ts:386`, `:399`). Already-on-chat and repeated-attempt cases pass (`:414`, `:426`). The error-channel case asserts successful settlement and no console/ErrorHandler error (`:440`). `core/services/app-state.service.ts:580` derives visible state from the Router. |
| 3. R8 lazy boundary | PASS. Independently searched repository TypeScript and the webview app, core, chat-family libraries, and shared sources. The only production reference loading `@ptah-extension/mcp-apps-page` is the dynamic import at `app/app.routes.ts:167`; the spec's identity check is also dynamic (`app/webview-routing.spec.ts:636`). No eager contract implementation import was found in those renderer consumers. Shared's existing exports at `libs/shared/src/index.ts:34` and `:35` expose type-only modules; `types/messages/payload-map.ts:129` and `types/rpc/rpc-surface.types.ts:20` use `import type`, so these do not pull contract validators/Zod into the eager bundle. Production router setup has no preloading feature (`app/app.config.ts:156`). Final emitted-bundle measurement remains B19's gate. |
| 4. D-1/R1 coverage and assertion strength | PASS within the existing, documented Jest scope. The only pre-existing excluded surface remains tribunal (`app/webview-routing.spec.ts:79`), owing to its transform limitation; no new exclusion was introduced. Both loops still derive from the canonical IDs (`:81`). History navigation runs with Electron enabled (`:209`), includes apps, and retains all History API assertions. The exact final-surface assertion changes from tasks to apps (`:220`), with identical strength because apps is appended last. Deep-link parameterization still expects each resolvable surface's exact route and enables Electron for apps (`:322`). A companion VS Code history walk additionally covers refusal (`:227`). Tribunal remains covered structurally, including its lazy-loader assertion (`:584`); these loops did not newly lose any surface. |
| 5. Canonical IDs, allow-list, R7 | PASS. Apps occurs once in the union after tasks (`types/webview-surface.types.ts:54`) and once in the canonical route list after tasks (`:75`). The accepted initial views derive from that list (`:100`); no second production route list was introduced. Exact ordering/uniqueness tests (`types/webview-surface.types.spec.ts:23`), route lock-step (`app/webview-routing.spec.ts:529`), and host allow-list equality (`:533`) pass. Accepting apps at the VS Code input boundary is intended and safe: the guard then refuses it before loading and the Router reports chat. |
| 6. A1 Jest import resolution | PASS. Both the real-component resolution case (`app/webview-routing.spec.ts:610`) and exact barrel-export identity check (`:630`) pass under the existing webview transform. The Electron navigation loader spy calls through successfully. No fallback exclusion or config change is needed. |
| 7. Failure paths and missing requirements | PASS. Repeated refusal, refusal from chat, both host entry paths, invalid view handling (`app/webview-routing.spec.ts:285`), and default-host refusal (`:512`) are covered. Existing shared input tests reject malformed strings and non-strings (`types/webview-surface.types.spec.ts:84`, `:96`). Lazy dependency rejection remains caught and reported as failed navigation by `core/routing/surface-router.service.ts:136`, rather than silently succeeding. The route includes the required SURFACE_ACTIVE provider (`app/app.routes.ts:164`). No new correctness defect or missing Batch 16 requirement was identified. |

## Initialization and evidence limits

The guard reads the service at match time; it does not cache a module-level host value. The service itself initializes from globals once (`core/services/vscode.service.ts:109`, `:126`). If config is absent when constructed, the guard safely refuses. Replacing `window.ptahConfig` later does not refresh that service or automatically replay the rejected navigation. This is the existing initialization contract, not a new recovery capability: Electron exposes both bridge and `isElectron: true` synchronously in preload (`apps/ptah-electron/src/preload.ts:18`, `:23`, `:34`) before Angular bootstrap. Existing guard tests exercise true/false and the real default; they do not simulate late global replacement.

The initial-view helper reproduces the production normalization/navigation sequence rather than constructing App (`app/webview-routing.spec.ts:153`); it matches `app/app.ts:136`. The accepted inert slice stamp described in plan D2 remains outside scope: visible `currentView()` is Router-derived and the refusal tests verify chat.

## Verification

- Independently ran the permitted `webview-routing.spec.ts` with the webview Jest config and `--maxWorkers=2`: **61 passed**, exit 0.
- Independently ran `webview-surface.types.spec.ts` with the shared Jest config and `--maxWorkers=2`: **42 passed**, exit 0.
- Read the accepted nine-error spec-tsc baseline and coordinator verification. Did not rerun tsc or broader project suites; their results are reported evidence, not independently reproduced here.
- No production bundle build or browser network capture was run. The no-fetch conclusion follows from the verified loader refusal, eager-import search, and absence of router preloading.

## Numbered findings

None. No Blocking, Serious, Moderate, or Minor correctness finding.

## Exact fix list

None required.

Summary: APPROVED — Electron can reach the lazy Apps route; VS Code refuses it before loading and settles on chat, with existing routing coverage preserved.

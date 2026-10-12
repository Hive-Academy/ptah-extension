# H1 host implementation report

## Files changed

- `apps/ptah-extension-vscode/package.json` — activates on restored `ptah-angular-spa` panels.
- `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts` — shares panel adoption between creation and deserialization, with validated ID reuse.
- `apps/ptah-extension-vscode/src/core/ptah-extension.ts` — registers and owns the serializer disposable.
- `apps/ptah-extension-vscode/src/providers/angular-webview.provider.spec.ts` — covers adoption, state and ID cases.
- `apps/ptah-extension-vscode/src/core/ptah-extension.spec.ts` — covers serializer registration and disposal.

## Host contract trace

- Shared state parser: `angular-webview.provider.ts:10,145`; the provider reads the supplied state but does not write to it. The provider spec checks preservation at `angular-webview.provider.spec.ts:115-125`.
- Restore precedence: `angular-webview.provider.ts:153,225` adopts without an `initialView` option, so the generator emits `ptahConfig.initialView: null` (`apps/ptah-extension-vscode/src/services/webview-html-generator.ts:464-466`). No route-derived view or URL is passed. The spec checks omission at `angular-webview.provider.spec.ts:128,187`.
- Panel ownership and ID: `angular-webview.provider.ts:145-153` requires successful parsing, the stricter panel ID regex, and no live collision. `angular-webview.provider.ts:166-172` allocates a UUID fallback. Both paths use `adoptPanel` (`angular-webview.provider.ts:130,153,192`), which sets webview options, HTML, manager registration, queue, listener, ready flush and disposal (`angular-webview.provider.ts:201-257`). The generated config receives the chosen ID at `angular-webview.provider.ts:225`.
- Wizard boundary: `ptah-extension.ts:132-135` registers only `ptah-angular-spa`; `package.json:38` names only that panel activation.
- Activation timing and disposal: `ptah-extension.ts:61-64` registers during initialization; `ptah-extension.ts:132-136,224-225` owns and disposes the registration.

## Specs added

- `angular-webview.provider.spec.ts:114-150`: valid chat and Thoth state, unchanged state, adopted panel, ID in HTML generator options, listener, webview options and cleanup.
- `angular-webview.provider.spec.ts:153-192`: captured creation options match fresh/restored webview options; message wiring, creation retention option, no restored `initialView` and ready flush without an added broadcast.
- `angular-webview.provider.spec.ts:194-204`: separate valid restored IDs coexist.
- `angular-webview.provider.spec.ts:206-229`: a live valid ID collision, malformed ID, unknown version, external URL and absent state allocate distinct IDs.
- `angular-webview.provider.spec.ts:231-251`: throwing HTML generation logs, disposes the panel, and leaves no live panel, manager entry or queue.
- `angular-webview.provider.spec.ts:253-272`: throwing listener setup rolls back panel, manager and queue registrations.
- `ptah-extension.spec.ts:11-45`: exact serializer view type during initialization, sidebar registration and disposal.

## Deviations and open risks

- No change outside the five H1 project files, apart from this required report. A restored panel's `WebviewPanel.options` is read only in the VS Code API; adoption reapplies its writable `webview.options`, while creation sets `retainContextWhenHidden` on panel creation. Retention on restored panels needs a manual VS Code smoke check.
- Tests, lint, typecheck, build and Nx were not run, as explicitly requested. `git diff --check` found no whitespace errors. The orchestrator owns scoped verification and a manual VS Code restart smoke check.
- Route restoration still depends on the companion webview code persisting `ptahRoute` before restart; serializer registration also depends on successful extension initialization.

## Revise round 1

- Failure safety: `angular-webview.provider.ts:204-257` attaches disposal cleanup before HTML generation and generates HTML before registration; `angular-webview.provider.ts:129-137,140-163` disposes a failed panel and logs restore errors. Failure specs are at `angular-webview.provider.spec.ts:231-272`.
- Collision proof: `angular-webview.provider.spec.ts:206-229` restores two fully valid states with the same live panel ID, then requires the second ID to differ. Removing the live-ID guard at `angular-webview.provider.ts:150` would fail it.
- Ready behavior: `angular-webview.provider.ts:241-248` now only marks ready and flushes, as creation did before H1. The existing workspace-change broadcast still reaches all tracked panels from `angular-webview.provider.ts:263-277`; no per-ready broadcast was added.
- Formatting and options: Prettier formatted both specs; the stray blank line is removed in `angular-webview.provider.ts:252-258`. `angular-webview.provider.spec.ts:58-85,161-176` captures options actually passed to `createWebviewPanel` and compares them with both adopted webviews.

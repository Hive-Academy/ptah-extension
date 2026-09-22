# Batch B2 — `@ptah-extension/chat` — COMPLETE

Spec implemented: `implementation-plan.md` spec 10 (`ChatEmptyStateComponent`
after-state + `McpStatusChipComponent.navigateToMarketplace`). Depends on B1a
(`encodeMarketplaceTarget` from `@ptah-extension/core`), which is landed.

## Files changed

- MODIFIED `libs/frontend/chat/src/lib/components/molecules/setup-plugins/chat-empty-state.component.ts`
  — tabs, Ptah Skills card, plugin widget and modal removed; warning button now
  deep-links to the Marketplace Skills section; catalog read moved to `ngOnInit`.
- MODIFIED `libs/frontend/chat/src/lib/components/molecules/mcp-status-chip.component.ts`
  — `navigateToMarketplace(source)` writes `encodeMarketplaceTarget('apps', source)`.
- MODIFIED `libs/frontend/chat/src/lib/components/molecules/mcp-status-chip.component.spec.ts`
  — three assertions re-pointed from `'smithery'`/`'connectors'` to
  `'apps:smithery'`/`'apps:connectors'` (see Deviations).

Verify-only, unchanged as the plan predicted: `chat-view.keepalive.spec.ts`
(`:70,166-167`) and `transcript/testing/transcript-spec-harness.ts`
(`:16,82-85`). Both stub the component with an empty template and a
`remove: { imports: [ChatEmptyStateComponent] }`; selector
`ptah-chat-empty-state` and `promptSelected = output<string>()` are unchanged,
so the stub contract still resolves.

`libs/frontend/chat/src/lib/components/index.ts` NOT touched — it still
re-exports `PluginStatusWidgetComponent` and `PluginBrowserModalComponent` at
`:124-125`. B4 owns that removal.

## What remains in the empty state

| Kept                                          | Notes                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Hero (logo, divine glow, title, tagline)      | unchanged                                                                                          |
| `Skills Not Configured` warning               | `hasConfiguredSkills()` unchanged, including its deliberate suppression until `catalog.isLoaded()` |
| Intelligent Project Setup glass card          | unchanged, with `<ptah-setup-status-widget>`                                                       |
| ONE `<ptah-prompt-suggestions>`               | the skills-tab duplicate is gone                                                                   |
| Hieroglyph footer                             | unchanged                                                                                          |
| `.tab-content-animated` + `@keyframes fadeIn` | applied to the single remaining content block, per spec 10                                         |

Removed: tab bar, Ptah Skills card, `<ptah-plugin-status-widget>`,
`<ptah-plugin-browser-modal>`, `activeTab`, `setActiveTab`,
`isPluginBrowserOpen`, `openPluginBrowser`, `closePluginBrowser`,
`onPluginsSaved`, `PuzzleIcon` (and the `Puzzle` lucide import), the
`.tabs-boxed .tab*` styles, the `CommandDiscoveryFacade` injection, and the now
unused `signal` import. The class doc comment was rewritten to describe the
single-column content.

New behaviour on the warning button (relabelled
`Configure Skills First` → `Open Marketplace Skills`):

```ts
this.appState.setMarketplaceActiveProvider(encodeMarketplaceTarget('skills', 'ptah-plugins'));
void this.navigation.navigateToView('marketplace');
```

`AppStateManager`, `WebviewNavigationService` and `encodeMarketplaceTarget` all
come from `@ptah-extension/core`. No import of `@ptah-extension/marketplace`
anywhere in `chat` (the two remaining textual matches are doc comments).

The catalogue read that `setActiveTab('setup')` used to perform is now
`ngOnInit(): void { void this.catalog.ensureLoaded(); }` — without it the
warning, which is on screen from first paint, would never evaluate.

## Verification

| Command                                                           | Result                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx run-many -t test -p @ptah-extension/chat --skip-nx-cache` | **PASS** — header `Running target test for project @ptah-extension/chat` (1 project). 91 suites passed / 91; 1494 tests passed, 2 skipped, 0 failed.                                                                                                                                                                                                                                                        |
| `npx nx run-many -t lint -p @ptah-extension/chat --skip-nx-cache` | **PASS** — `Successfully ran target lint`. 19 problems, **0 errors, 19 warnings**, every one pre-existing in files this batch did not touch (`chat-input`, `inline-agent-bubble`, `app-shell`, `chat-view*`, `session-loader`, `provider-setup-wizard`, `agent-orchestration-config`, `ptah-cli-config`). Neither `chat-empty-state.component.ts` nor `mcp-status-chip.component.ts` appears in the output. |

Zero `as any`, zero `@ts-ignore`, zero `eslint-disable` added. `OnPush`
retained on both components.

Note: jest reported "A worker process has failed to exit gracefully" — a
pre-existing teardown leak in the `chat` suite, not a failure, and unrelated to
these files (the run still reports 0 failed and nx reports success).

## Deviations from the brief

1. **`mcp-status-chip.component.spec.ts` was edited.** The brief's file list for
   B2 names only the two component files. The chip's own spec asserts the exact
   string passed to `setMarketplaceActiveProvider` at `:298`, `:348` and `:362`;
   spec 10 changes that string, so leaving the spec alone would have left the
   batch red and violated the "no completion while a required check fails" rule.
   The file is the co-located spec of a component B2 owns, it is in the same lib,
   and no other batch's row claims it. Only the three expected strings changed —
   no test was added, removed or weakened. This is AC6's pin.
2. **`ChatEmptyStateComponent` now implements `OnInit`.** The plan says "moves to
   `ngOnInit`" without naming the interface; declaring it is the repository's
   normal form and keeps the lifecycle hook type-checked.

## Out-of-scope observations

- `libs/frontend/chat/src/lib/components/index.ts:124-125` still re-exports
  `PluginStatusWidgetComponent` and `PluginBrowserModalComponent` from
  `chat-ui`. After B1 deletes them this barrel breaks the `chat` build; B4 owns
  the file and must land in the same wave as the deletion.
- `chat-empty-state.component.ts` has no spec of its own and did not before this
  change, so the new `openMarketplaceSkills()` path and the `ngOnInit` catalog
  read are covered only indirectly. If the judge wants AC4 pinned by a test
  rather than by inspection, that is a small new spec file in this lib.
- `workspace-coordinator.service.spec.ts:493,506,513` still seeds the retired ids
  `'skills-sh'` and `'official-mcp'` into `marketplaceActiveProvider`. It asserts
  only clear-vs-preserve across a workspace switch, so it is id-agnostic and
  still passes — but those literals are now dead grammar and would read better as
  `'apps:smithery'`. Not touched.

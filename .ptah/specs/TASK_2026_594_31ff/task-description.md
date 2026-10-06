# Status set and static text catalog requirements

Revision: 3

## Summary

Add the daisyUI status set (`alert`, `badge`, `progress`, `radial-progress`, and `divider`) and the static `text-block` display kind to the Ptah surface catalog in one compatible catalog-only bump from `dashboard-catalog/2` to `dashboard-catalog/3`. The work makes those semantic kinds available through the backend contract and declarative-dashboard renderer, documents the entire catalog in the existing extension skill, and makes the Apps-page agent discover that skill.

Classification: **FEATURE**, estimate **M**. This is a bounded, cross-project user-visible capability addition: six new contract kinds require shared validation, renderer behavior, agent guidance, generated content metadata, and targeted regressions; it does not change the schema version or introduce a new interaction protocol. [user-requested]

## In scope

- Add the six semantic display kinds to the surface contract, its type model, strict Zod validation, text fallback, validation/budget/contract regressions, and the `dashboard-catalog/3` version contract. [user-requested]
- Render every new kind in `declarative-dashboard`, including both dark and light theme coverage. [user-requested]
- Keep status values semantic and map them to daisyUI only inside the renderer. [user-requested]
- Extend the existing `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/` skill with `references/catalog.md`, regenerate its checked-in content manifest, and point `APPS_SYSTEM_PROMPT` to it. [user-requested]
- Ensure `buildSurfaceUpdateTool` in `libs/backend/vscode-lm-tools` describes the expanded surface vocabulary and has a focused completeness regression; the description shall remain derived from the contract rather than become a parallel catalog. [user-requested]

## Out of scope

- Structure kinds (`tabs`, `collapse`, `steps`, `timeline`), content kinds beyond `text-block`, and new input kinds: this request is limited to the named status set plus static text. [user-requested]
- Iframes and all agent-supplied HTML, CSS, or class names: they cross the existing untrusted-content boundary rather than adding a semantic catalog capability. [user-requested]
- Deferred: no display kind binds the data model today. A new data-model binding grammar for status displays remains out of scope because current display components are literal while input components own `path` bindings. [lane-proposed; source: `surface.schemas.ts:286-400`]
- A `dashboard-spec/3` schema version: the user chose one catalog bump only; legacy dashboard spec versions remain supported (`dashboard-spec/1` + `/1`, and `dashboard-spec/2` at `dashboard-catalog/3`; see criterion 7). [user-requested]
- ptah-ui `note` → `alert` conversion — TASK_2026_610 D3. [project-rule; source: `TASK_2026_610_6a10/implementation-plan.md:710`]

## Contracted kind properties

All text-valued properties below are `RichText` in the established plain-text-only format (`DASHBOARD_TEXT_FORMATS = ['plain']`); every component also has the established bounded `id`, and only the established, allowlisted `actions` shape may be used where noted. The closed tone sets below deliberately contain semantic tokens, never daisyUI class strings. [project-rule; source: `dashboard-catalog.ts:13-19,138-140`; lane-proposed]

| Kind | Required properties | Optional properties | Closed values and behavior |
| --- | --- | --- | --- |
| `alert` | `tone`, `text` | `title` | `tone` is `info | success | warning | error`; render a concise inline note from `tone + text` when no title is supplied, so ptah-ui `note` can map to it. [user-requested] |
| `badge` | `tone`, `text` | `actions` | `tone` is `neutral | primary | info | success | warning | error`; the optional actions are restricted to `dashboard.select`, with no new badge action. [user-requested; lane-proposed] |
| `progress` | `value`, `tone`, `label` | none | `value` is a finite numeric literal in the inclusive range `0..100`; `tone` is `neutral | primary | info | success | warning | error`. Binding is deferred: it has no `path`, `data`, or other data-model binding, and changes through the existing surface patch/update flow. [user-requested; lane-proposed] |
| `radial-progress` | `value`, `tone`, `label` | none | Same literal numeric range, tone set, and no-binding rule as `progress`; expose the value as the progress percentage. [user-requested; lane-proposed] |
| `divider` | `direction` | `text` | `direction` is `horizontal | vertical`; the optional text is plain RichText. [user-requested] |
| `text-block` | `text`, `role` | none | `role` is `heading | body`; it is static plain text, not the existing `text` input kind. [user-requested; source: `TASK_2026_610_6a10/implementation-plan.md:702-722`] |

New kinds do not take the common `displayShape` fields except where this table explicitly lists them. [lane-proposed; source: `surface.schemas.ts:325-330`]

## Acceptance criteria

1. When a surface document names any of the six in-scope kinds with the properties in the table, the shared backend contract and webview intake shall validate it, and declarative-dashboard shall render it in both dark and light themes. [user-requested]
2. When `{ id, kind: 'alert', tone, text }` with no other field is validated, the shared validator and webview intake shall accept it; when `title` is absent, the rendered alert shall contain no title element and no empty title placeholder; when `title` is present, it shall render before the text inside the same alert element. [user-requested]
3. When a `progress` or `radial-progress` value is an inclusive finite number from 0 through 100, the system shall render that percentage and its accessible value; when it is below 0, above 100, non-finite, or not numeric, validation shall reject the whole document. These kinds shall not accept data-model binding fields. [user-requested; lane-proposed]
4. When any new component supplies an unknown tone or direction/role enum member, a `class`, `style`, or `html` field, an extra field, a value outside the stated range, or a `badge` action other than `dashboard.select` (pending Q2), the strict shared schema and webview validation path shall reject the document rather than render a partial surface. [user-requested; project-rule; source: `surface.schemas.ts:291-419`, `dashboard-catalog.ts:51-54`]
5. When a `text-block` has a known role and non-empty plain RichText within the existing `SURFACE_LIMITS.maxStringLength` limit, the system shall render it and include a heading or body line in text fallback; when its role is unknown, its text is empty or over that limit, or it has an extra field, validation shall reject it. [user-requested; source: `TASK_2026_610_6a10/implementation-plan.md:711-715`, `dashboard-catalog.ts:161-175`]
6. When each status kind (`alert`, `badge`, `progress`, `radial-progress`, and `divider`) is supplied as a valid surface component, the text fallback shall emit one line per component containing: alert tone and text; badge text; progress and radial-progress label and value as a percentage; divider text when present, and a divider line when `text` is absent. [user-requested]
7. When a `dashboard-spec/1` plus `dashboard-catalog/1` envelope is supplied, it shall validate and render unchanged; when a `dashboard-spec/2` plus `dashboard-catalog/3` envelope is supplied with any pre-existing kind, it shall validate and render that kind unchanged; when a `dashboard-spec/2` plus `dashboard-catalog/2` envelope is supplied after the bump, it shall be rejected with the version-pair error. [user-requested; lane-proposed]
8. When a `dashboard-spec/1` document names any of the six new kinds, validation shall reject it; `DASHBOARD_COMPONENT_KINDS` and both the enum and description exposed by `ptah_dashboard_propose_spec` shall list exactly the five v1 kinds. This preserves the catalog-version boundary established in `dashboard-catalog.ts:37-41`, rather than silently expanding the v1 vocabulary. [user-requested; lane-proposed]
9. When a surface envelope, type declaration, view-model guard, fixture, harness, or targeted test currently contains `dashboard-catalog/2`, it shall contain or derive `dashboard-catalog/3` consistently; `SURFACE_CATALOG_VERSION` shall equal exactly `'dashboard-catalog/3'`, while `SURFACE_SCHEMA_VERSION` remains `dashboard-spec/2`. Catalog and schema versions are independent contract dimensions, as established in `dashboard-catalog.ts:37-41`. [user-requested; lane-proposed]
10. When the version bump is implemented, the following currently discovered literal-version sites shall be updated or changed to derive the shared constant, with their assertions preserving the version-3 contract: `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts:102`; `apps/ptah-electron/src/di/surface-composition.spec.ts:106,117`; `libs/shared/src/testing/fixtures/surface.ts:31`; `libs/shared/src/mcp-apps-contracts/surface.types.ts:124`; `surface-catalog.ts:11`; `surface-contract.spec.ts:63`; `surface-budgets.spec.ts:50`; `surface-validator.spec.ts:241,257,263,286`; `ptah-ui-converter.spec.ts:132`; `libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.ts:113`; `surface-view-model.spec.ts:21`; `budget-render.spec.ts:93`; `trust-boundary.spec.ts:30`; `components/surface-node.component.spec.ts:15`; `surface-layout.component.spec.ts:17`; `surface-choice-input.component.spec.ts:23`; `surface-checkbox-input.component.spec.ts:14`; `surface-text-input.component.spec.ts:23`; `surface-renderer.component.spec.ts:22`; `libs/frontend/mcp-apps-page/src/lib/state/apps-surface-reducer.spec.ts:49`; `apps-surface-intake.spec.ts:37`; `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-sync.spec.ts:31`; `apps-surface-operations.service.spec.ts:74`; `apps-surface-lanes.spec.ts:55`; `apps-session.service.spec.ts:46`; `apps-submit-flow.spec.ts:65`; `libs/frontend/mcp-apps-page/src/lib/components/apps-surface-panel.component.spec.ts:38`; `apps-page.component.spec.ts:134`; `apps-page-conversation.spec.ts:126`; `libs/backend/rpc-handlers/src/test-utils/surface-rpc-harness.ts:111`; `libs/backend/cli-engine/src/lib/surface-composition.spec.ts:81,93`; `libs/backend/vscode-lm-tools/src/lib/surface/surface-trust-boundary.spec.ts:53`; `surface-state.store.spec.ts:23`; `surface-state.service.submit.spec.ts:85`; `surface-state.service.spec.ts:83`; `surface-state.service.failure.spec.ts:43`; `surface-state-reader.spec.ts:70`; `surface-state-reader.budget.spec.ts:50`; `libs/backend/vscode-lm-tools/src/lib/di/register.spec.ts:342`; `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/surface-namespace.builder.spec.ts:15`; and `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.surface.spec.ts:39`. [user-requested]
11. When `buildSurfaceUpdateTool` supplies its MCP tool description, it shall name the six new kinds and the literal `dashboard-catalog/3`; `surface-tools.spec.ts` shall contain a completeness case that fails if the description omits a kind in `SURFACE_COMPONENT_KINDS`. [user-requested]
12. When `SURFACE_COMPONENT_KINDS` changes, `ptah-surface-authoring/references/catalog.md` shall contain every current kind and exactly one valid JSON example for each; a focused specification shall fail if any catalog kind lacks that reference entry, and shall validate each example through `validateSurfaceDocument` inside a `dashboard-spec/2` plus `dashboard-catalog/3` envelope. [user-requested]
13. When the skill changes, `npm run manifest:generate` shall regenerate the checked-in `content-manifest.json` so the existing plugin-delivered skill and its new catalog reference are discoverable, and `npm run manifest:check` shall pass. [user-requested]
14. When `APPS_SYSTEM_PROMPT` is built, it shall name the `ptah-surface-authoring` skill and list all supported surface kinds in one line, directing the Apps-page agent to the skill rather than embedding a second catalog; a specification shall fail if any `SURFACE_COMPONENT_KINDS` member is absent from that prompt. [user-requested]
15. When the targeted project test commands run, `nx test` shall pass for `shared`, `declarative-dashboard`, `mcp-apps-page`, `vscode-lm-tools`, `rpc-handlers`, `cli-engine`, `ptah-extension-vscode`, and `ptah-electron`; when the webview closure gate runs, `npm run gate:eager-closure` shall pass. [user-requested]

## Non-functional constraints

- Treat every agent-provided field as untrusted. The strict schemas must remain fail-closed and retain the existing plain-text, action-allowlist, URL-allowlist, and host-mediation controls; no renderer may consume agent HTML, style, or classes. [project-rule; source: `dashboard-catalog.ts:13-19,51-54`]
- The new Angular renderer components shall be standalone and use `ChangeDetectionStrategy.OnPush`, following the existing declarative-dashboard component convention. [project-rule; source: project guidance]
- New semantic status renderers shall provide accessible semantics: warning and error alerts announce assertively, while info and success alerts do not (for example, use `role="status"`); alert tone shall be conveyed in text, not colour alone. Progress variants expose `role="progressbar"` and `aria-valuemin="0"`, `aria-valuemax="100"`, and the current `aria-valuenow`; text labels remain available to assistive technology. [project-rule; source: project guidance; lane-proposed]
- New values shall remain within existing component, string, JSON, and surface budgets; the work shall extend budget cases rather than widen limits without evidence. [project-rule; source: `surface-catalog.ts:79-92`, `dashboard-catalog.ts:161-175`]

## Stakeholders

- Apps-page users need concise notices, statuses, dividers, percentages, and static text that render predictably in either theme. [user-requested]
- AI agents authoring Ptah surfaces need one discoverable, complete catalog reference and prompt pointer so they emit semantic, valid JSON. [user-requested]
- Extension/Electron/CLI host maintainers need one versioned contract and regression coverage so tool validation and renderers do not drift. [project-rule; source: shared surface contract architecture]

## Risks and mitigations

- **Contract/version drift:** scattered version literals can make valid version-3 surfaces fail in a host or fixture. **Mitigation:** satisfy criteria 9–10 and the eight projects in criterion 15. [user-requested]
- **Trust-boundary regression:** convenience styling props could reintroduce agent-controlled markup or classes. **Mitigation:** use only the closed semantic props above and add rejection tests for prohibited and extra fields. [user-requested]
- **Skill/catalog drift:** a manually maintained reference can omit a supported kind. **Mitigation:** add the completeness specification required by criterion 12 and regenerate the manifest. [user-requested]
- **Webview eager-closure growth:** adding eager renderer imports could fail the webview bundle constraint. **Mitigation:** keep renderer integration compatible with the existing deferred/lazy boundary and run `npm run gate:eager-closure`. [user-requested]

## Open questions for the user

- Q1: Should `dashboard-spec/2` plus `dashboard-catalog/2` envelopes be rejected after the bump (recommended), or still accepted? [lane-proposed]
- Q2: Should badge actions be limited to `dashboard.select` (recommended), or use the full `SURFACE_ACTIONS` allowlist? [lane-proposed]
- Q3: Should `progress` and `radial-progress` use literal values only now with binding deferred (recommended), or add data-model binding now? [lane-proposed]

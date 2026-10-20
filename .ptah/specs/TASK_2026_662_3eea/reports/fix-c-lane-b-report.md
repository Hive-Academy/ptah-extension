# Phase C fix round — Lane B

## Files changed

- `libs/frontend/chat/src/lib/settings/providers/routing-map.component.ts` — counts and displays Memory curator, Enhancement, and Decision with truthful default wording.
- `libs/frontend/chat/src/lib/settings/providers/routing-map.component.spec.ts` — expects three roles and checks default rows and footer.
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-specs-control.component.ts` — adds the compact orchestration specs card and actions.
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-specs-control.component.spec.ts` — covers initial refresh, actions, counts, and disabled buttons.
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts` — mounts the specs control below the Library.
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.spec.ts` — extends the state fake and verifies the card is mounted.
- `libs/frontend/skill-synthesis-ui/src/index.ts` — exports the new component alongside the existing components.

## Fixes

- Routing map: `routing-map.component.ts:24-34` adds Decision to the preview and derives the total from `BACKGROUND_ROLE_IDS.length`; `routing-map.component.ts:150-163` displays each unset role by name. `routing-map.component.ts:248` reports the count. `routing-map.component.spec.ts:57-64,186-202` covers the three-role output.
- Specs control: `skill-specs-control.component.ts:9-24` provides the compact card, help text, counts, and two actions; `skill-specs-control.component.ts:32-43` refreshes once on init and calls harvest/archive methods. `skill-synthesis-tab.component.ts:106-112` mounts it after the Library. `skill-specs-control.component.spec.ts:32-62` verifies behavior.

Final routing-map wording: unset rows display **Default**; the footer displays **2 set · 1 default** for the currently mocked two-provider case. The status displays **3 roles**.

## Decisions

- **Decision status:** `ProvidersSettingsStateService` exposes memory and enhancement sections but no decision-model section (`providers-settings-state.service.ts:116-160`). The separate decision-model row reads its own status. Therefore this map counts Decision through `BACKGROUND_ROLE_IDS.length` and displays it as Default without asserting a provider. Options were to add a new state/RPC path or to use the specified fallback; the fallback stays within scope and is reversible.
- **Unset wording:** An unset Decision model uses code ranking and does not necessarily follow the main agent. Replaced the aggregate “following” line with named default rows and a “default” footer. This is reversible UI wording.

## Verification and limits

- Confirmed all seven changed TypeScript files are UTF-8 without BOM and inspected targeted source references.
- Did not run tests, typecheck, lint, build, Nx, Jest, or diagnostics because the lane instructions reserve verification for the orchestrator.
- A selected Decision provider cannot be shown through the current `ProvidersSettingsStateService`; exposing that status would require a separate service change outside this lane's scope.

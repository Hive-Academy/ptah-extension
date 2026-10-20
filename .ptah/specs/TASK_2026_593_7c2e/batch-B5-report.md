# Batch B5a + B5b report

## Summary
Implemented VS Code native attention notices, aggregate Ptah view visibility, panel visibility bridging, queued Open Ptah routing through the Angular provider, and coordinator observer attachment.

## Files
- `libs/backend/platform-vscode/src/implementations/vscode-host-attention-notifications.ts` and `.spec.ts`: safe titled host notices, generation invalidation, Open routing, shared host contract.
- `libs/backend/platform-vscode/src/implementations/ptah-view-visibility.ts` and `.spec.ts`: lazy manager lookup, visibility snapshot, change subscription.
- `libs/backend/platform-vscode/src/registration.ts` and `src/index.ts`: register and export the new adapters.
- `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts` and `.spec.ts`: panel visibility event bridge and readiness queued Open routes for sidebar and panels.
- `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`: attach coordinator to actual manager and retain disposable in extension context.
- `apps/ptah-extension-vscode/src/di/expected-resolvable.ts` and `container.smoke.spec.ts`: pin attention tokens.

## Decisions
- Use the existing WebviewEventQueue in AngularWebviewProvider for Open routes. Direct manager broadcast can reach a webview before Angular is ready; the provider already has one readiness queue per view. Reversible.
- Adapt editor panel view-state events to the manager's WebviewView visibility event at registration. This preserves the existing manager API while allowing aggregate visibility to include panels. Reversible.
- Always display the coordinator's safe session title in native notices, per decision #21. Reversible only by user decision.

## Not done
- Nx, Jest, TypeScript, lint, build, and diagnostics were not run because the assignment explicitly reserves scoped checks for the orchestrator. The new specs and DI wiring need that verification.

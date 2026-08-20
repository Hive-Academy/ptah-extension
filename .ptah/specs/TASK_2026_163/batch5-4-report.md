# TASK_2026_163 Batch 5 Lane B5.4 — Electron e2e + showcase-scene sweep

## Summary

Removed stale license/trial/premium lockout assertions and narration from the Electron e2e suite and showcase scenes after Ptah went fully open source. The `license:` RPC family still exists and is tested for answer shape only; no test asserts that it blocks access.

## Per-file actions

### `apps/ptah-electron-e2e/src/support/ui-driver.ts`

- Removed `isLicensed` from `StartupConfigSeed` interface.
- Removed `isLicensed: true` from `DEFAULT_STARTUP_CONFIG`.
- Removed `isLicensed` from the `get-startup-config` return payload.

### `apps/ptah-electron-e2e/src/specs/startup-config.spec.ts`

- Removed `isLicensed` from the `StartupConfig` interface and doc comment.
- Renamed/rewrote tests to assert the new open-access shape: `initialView` defaults to `'chat'` (string | null), plus `workspaceRoot`/`workspaceName`.
- Removed stability assertions that referenced `isLicensed`.

### `apps/ptah-electron-e2e/src/specs/license-watcher.spec.ts`

- Dropped the `welcome` routing assertion block (~old :78-83).
- Rewrote the `license:getStatus` test to assert answer shape only (`valid`, `tier`) and dropped the `isPremium` lockout assertion (~old :189).
- Removed `isLicensed` from the captured startup-config type annotation.
- Removed `isPremium` from the `license:getStatus` response type annotation.
- Kept the DI-registration, event-wiring, revalidation-interval, and malformed-key tests intact.

### `apps/ptah-electron-e2e/src/specs/setup-wizard/wizard-dom.spec.ts`

- Removed the `license:getStatus: { isPremium: true }` RPC mocks from both tests.
- Kept assertions on the `welcome` step, which still exists as the first wizard step.

### `apps/ptah-electron-e2e/src/showcase/_harness/director.ts`

- Updated the `dismissDialogs()` doc comment to no longer single out the license/trial modal.
- Kept the helper itself for any future blocking dialogs.

### Showcase scenes — removed all trial-modal dismissal calls and trial/premium-gate narration

| File                         | Changes                                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marketplace-tour.scene.ts`  | Removed gating note, removed all `dismissDialogs()` calls, deleted the non-premium/trial-ended branch, and now tours the provider grid unconditionally.                                                  |
| `canvas-orchestra.scene.ts`  | Removed startup trial-modal comment and two `dismissDialogs()` calls.                                                                                                                                    |
| `dashboard-tour.scene.ts`    | Removed trial-modal dismissal calls; seeded `localStorage.setItem('ptah.builders-card.dismissed', '1')` before navigation so the new open-source Builders card does not disturb the dashboard card flow. |
| `chat-code-edit.scene.ts`    | Removed trial-modal comments and all `dismissDialogs()` calls.                                                                                                                                           |
| `skills-tour.scene.ts`       | Removed trial-modal comments and all `dismissDialogs()` calls.                                                                                                                                           |
| `thoth-tour.scene.ts`        | Removed trial-modal comments and all `dismissDialogs()` calls.                                                                                                                                           |
| `gateway-tour.scene.ts`      | Removed trial-modal comments and all `dismissDialogs()` calls.                                                                                                                                           |
| `memory-recall.scene.ts`     | Removed trial-modal comments and all `dismissDialogs()` calls.                                                                                                                                           |
| `cron-tour.scene.ts`         | Removed trial-modal comments and all `dismissDialogs()` calls.                                                                                                                                           |
| `tribunal-tour.scene.ts`     | Removed trial-modal comments and all `dismissDialogs()` calls.                                                                                                                                           |
| `setup-wizard-tour.scene.ts` | Removed premium-gate/upsell fallback, removed `dismissDialogs()` calls, and now assumes the wizard step container renders.                                                                               |
| `settings-tour.scene.ts`     | Removed trial-modal comments and all `dismissDialogs()` calls.                                                                                                                                           |
| `editor-tour.scene.ts`       | Removed all `dismissDialogs()` calls.                                                                                                                                                                    |

### `apps/ptah-electron-e2e/src/showcase/scripts/landing-page-tour.json`

- Replaced the trial CTA line with open-source copy: `"It remembers. It learns. It ships. Free and open source. No credit card, ever."`.

## Remaining grep hits justification

Command run:

```text
grep -rniE "isPremium|isLicensed|'welcome'|trial|premium" apps/ptah-electron-e2e/src
```

Remaining hits are only the word `welcome` in setup-wizard contexts:

- `showcase/setup-wizard-tour.scene.ts` — the setup wizard still begins on a step literally named `welcome` (`ptah-welcome` component, `data-step="welcome"`). These references describe the existing UI surface, not a license gate.
- `specs/setup-wizard/wizard-dom.spec.ts` — asserts the wizard opens on the `welcome` step and that `ptah-welcome` is visible. Open-access behavior; no lockout.

No remaining hits for `isPremium`, `isLicensed`, `trial`, or `premium`.

## Typecheck output

```text
> nx run ptah-electron-e2e:typecheck

> tsc --noEmit --project apps/ptah-electron-e2e/tsconfig.spec.json

 NX   Successfully ran target typecheck for project ptah-electron-e2e
```

Static typecheck is green.

---

LANE B5.4 DONE

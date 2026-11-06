# Live Codex Send now probe

## Provider and model selection

The test calls `auth:saveSettings` with `authMethod: thirdParty`, `anthropicProviderId: openai-codex`, and `applyTo: workspace`, then reads `config:models-list` for the scratch workspace. It fails with the offered IDs if none contains `luna`. It calls `config:model-switch` for the Luna ID at workspace scope and selects the visible Luna option in the chat model picker. The picker binds each `ptah-native-option` to `selectModel` at `libs/frontend/chat/src/lib/components/molecules/chat-input/model-selector.component.ts:130`; in a canvas tile that method records a tab override at lines 279-286. `config:models-list` and `config:model-switch` are registered at `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:519` and `:222`. The provider choice is a workspace setting, while the picker choice can be a tab override.

## Isolation

Provider selection and model switching can persist settings, so the Electron process gets a fresh `HOME` and `USERPROFILE`, following `apps/ptah-electron-e2e/src/support/real-rpc-fixtures.ts:48,260-261`. The app launcher merges caller environment at `apps/ptah-electron-e2e/src/support/electron-launcher.ts:107-115`. Explicit `CODEX_HOME` points to the real Codex auth directory, and `CLAUDE_CONFIG_DIR` points to the real Claude auth directory. `resolveCodexHome` prefers `CODEX_HOME` to `os.homedir()` at `libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts:51-57`; the Codex process receives the resolved path at `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts:213` and verifies the app server reports the same home at lines 247-256. Thus this combination should preserve Codex login while isolating Ptah settings. The paid live run has not confirmed it.

## Selectors and evidence

The spec uses `button[aria-label="Select model"]` and `ptah-native-option:visible` for Luna, `[data-testid="queued-follow-up-item"]` and nested `[data-testid="queued-follow-up-send-now"]` for the queued message, `[aria-label="Queued messages"]` for queue empty, and existing chat user/assistant test IDs for DOM history. The queue component renders the button label and queue status at `libs/frontend/chat/src/lib/components/molecules/queued-follow-ups/queued-follow-ups.component.ts:40-64,142`. It writes screenshots `20-codex-queued`, `21-codex-send-now-clicked`, `22-codex-steer-history`, plus `22-history.json` during the run.

## Unconfirmed assumptions

- The scratch workspace receives the workspace-scoped provider selection before chat's model list loads.
- A Luna ID is offered by the authenticated Codex model catalog on the coordinator's machine.
- `sleep 20` runs long enough for the queued state and Send now click before the turn ends.
- The visible assistant entry that contains `STEERED-C` represents the running turn's final reply; the test checks no later assistant entry appears after 20 seconds. It cannot inspect Codex's internal turn IDs from the DOM.
- The coordinator runs the opt-in spec and collects the artifacts; this lane did not run Playwright, Nx, or Electron.

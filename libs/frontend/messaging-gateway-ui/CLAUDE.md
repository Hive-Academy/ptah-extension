# Messaging Gateway UI

↩️ [Back to Main](../../../CLAUDE.md)

## Purpose

Electron-only "Gateway" tab inside the Thoth shell. Configures messaging adapters (Telegram, Discord, Slack) so users can drive Ptah agents from chat platforms. Renders master toggle, platform tab tiles with one pane per platform (token form, allow-list, bindings approval queue), voice settings, and rate-limit info.

## Boundaries

**Belongs here**: gateway tab UI, per-platform token entry, binding approval workflow.
**Does NOT belong**: adapter lifecycle / message handling (backend), token persistence (backend file-based settings).

## Public API

From `src/index.ts`: `MessagingGatewayTabComponent`, `GatewayRpcService`, `GatewayStateService`. Child components stay internal — no public-API change.

## Internal Structure

- `src/lib/components/`
  - `messaging-gateway-tab.component.ts` — shell: Electron gate, master-toggle card, global-error alert, voice toast, tab selection signal, voice/rate-limit card, setup-guide drawer toggle
  - `gateway-platform-tabs.component.ts` — WAI-ARIA `role="tablist"` tile buttons (lucide icons + per-platform status chips, roving tabindex, Arrow/Home/End/Enter/Space)
  - `gateway-platform-pane.component.ts` — ONE parameterized pane (`PlatformCardConfig` input) instantiated 3×; composes token form, allow-list editor, bindings panel, send-test, per-platform error alert; Discord pane adds the integration kit
  - `platform-token-form.component.ts` — bot token (+ Slack app token) inputs, local-only signals cleared in `finally`
  - `allow-list-editor.component.ts` — textarea draft + save + feedback
  - `discord-integration-kit.component.ts` — app id, invite link, Register `/ptah`, guild picker
  - `platform-bindings-panel.component.ts` — pending (code entry, approve/reject, allow-sender) + approved (revoke) lists, filtered to its platform
  - `gateway-setup-guide.component.ts` — help drawer
- `src/lib/services/` — `gateway-state.service.ts`, `gateway-rpc.service.ts`

## Key Files

- `src/lib/components/messaging-gateway-tab.component.ts:1` — shell; OnPush; `selectedPlatform` signal (Discord default; tile order Discord / Slack / Telegram); all three panes stay mounted and toggle via `[hidden]` so unsaved drafts survive tab switches.
- `src/lib/services/gateway-state.service.ts` — signal-backed state mirroring backend gateway status; `globalError` signal for non-attributable failures (`refreshStatus`, `listBindings`) vs `lastError` per-platform map fed by `recordPlatformError` (attributable callsites pass their platform — no cross-platform error smear).
- `src/lib/services/gateway-rpc.service.ts` — typed wrappers around gateway RPC methods.

## State Management

Signals + `computed`. Per-platform pane state from `GatewayStatusResult`. Token inputs are local component signals — they are dispatched then cleared (never persisted in component state). Tab selection lives in the shell; panes are dumb consumers of `GatewayStateService`.

## Dependencies

**Internal**: `@ptah-extension/core` (`VSCodeService`), `@ptah-extension/shared` (`GatewayBindingDto`, `GatewayPlatformId`).
**External**: `@angular/common`, `@angular/forms`, `lucide-angular`.

## Angular Conventions Observed

Standalone, OnPush, signals + `inject()`, `input()`/`output()`, control-flow blocks.

## Guidelines

- Always gate on `vscode.isElectron` — in VS Code, the placeholder must point to the desktop app.
- Never retain tokens in component signals after dispatch — clear them.
- Slack uniquely has an `appToken` field (`hasAppToken` in `PlatformCardConfig`); other adapters use bot token only.
- The approval queue is the only legitimate path to bind a remote user → workspace.
- Attribute errors to a platform when the callsite knows it; reserve `globalError` for status/list refreshes.
- Keep panes mounted-but-`[hidden]` — replacing with `@if` destroys in-flight drafts.

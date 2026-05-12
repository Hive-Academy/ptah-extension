# Messaging Gateway UI

↩️ [Back to Main](../../../CLAUDE.md)

## Purpose

Electron-only "Gateway" tab inside the Thoth shell. Configures messaging adapters (Telegram, Discord, Slack) so users can drive Ptah agents from chat platforms. Renders master toggle, per-platform token cards, pending-bindings approval queue, voice settings, and rate-limit info.

## Boundaries

**Belongs here**: gateway tab UI, per-platform token entry, binding approval workflow.
**Does NOT belong**: adapter lifecycle / message handling (backend), token persistence (backend file-based settings).

## Public API

From `src/index.ts`: `MessagingGatewayTabComponent`, `GatewayRpcService`, `GatewayStateService`.

## Internal Structure

- `src/lib/components/` — `messaging-gateway-tab.component.ts` (single composite tab)
- `src/lib/services/` — `gateway-state.service.ts`, `gateway-rpc.service.ts`

## Key Files

- `src/lib/components/messaging-gateway-tab.component.ts:1` — tab UI; OnPush; renders `PLATFORM_CARDS` (telegram, discord, slack); tokens cleared after dispatch; pending-bindings approval queue with code entry; one-time voice-model download toast.
- `src/lib/services/gateway-state.service.ts` — signal-backed state mirroring backend gateway status.
- `src/lib/services/gateway-rpc.service.ts` — typed wrappers around gateway RPC methods.

## State Management

Signals + `computed`. Per-platform card state from `GatewayStatusResult`. Token inputs are local component signals — they are dispatched then cleared (never persisted in component state).

## Dependencies

**Internal**: `@ptah-extension/core` (`VSCodeService`), `@ptah-extension/shared` (`GatewayBindingDto`, `GatewayPlatformId`).
**External**: `@angular/common`, `@angular/forms`.

## Angular Conventions Observed

Standalone, OnPush, signals + `inject()`, `ReactiveFormsModule`/`FormsModule`, control-flow blocks.

## Guidelines

- Always gate on `vscode.isElectron` — in VS Code, the placeholder must point to the desktop app.
- Never retain tokens in component signals after dispatch — clear them.
- Slack uniquely has an `appToken` field; other adapters use bot token only. Respect the `PLATFORM_CARDS` config.
- The approval queue is the only legitimate path to bind a remote user → workspace.

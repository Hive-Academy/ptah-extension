# TASK_2025_233: Sentry Integration — Error Tracking & Performance Tracing

## User Request

Integrate Sentry error tracking and performance tracing across 4 Ptah applications:

1. **ptah-extension-vscode** — VS Code extension backend (Node.js)
2. **ptah-electron** — Standalone Electron desktop app
3. **ptah-extension-webview** — Angular 20 frontend (webview SPA)
4. **ptah-license-server** — NestJS backend API

## Requirements

- **Error capture**: Catch unhandled exceptions and rejections in all 4 runtimes
- **Performance tracing**: Instrument key operations (RPC calls, API requests, agent sessions, chat interactions)
- **Call tracing**: Distributed tracing across frontend ↔ backend boundaries where applicable
- **Skip**: Landing page (ptah-landing-page) — not in scope

## Target Runtimes

| App                    | Runtime                          | Sentry SDK                     |
| ---------------------- | -------------------------------- | ------------------------------ |
| ptah-extension-vscode  | Node.js (VS Code extension host) | @sentry/node                   |
| ptah-electron          | Electron (main + renderer)       | @sentry/electron               |
| ptah-extension-webview | Angular 20 (browser)             | @sentry/angular                |
| ptah-license-server    | NestJS (Node.js)                 | @sentry/nestjs or @sentry/node |

## Constraints

- Must not break existing functionality
- Sentry DSN should be configurable via environment/settings
- Must respect user privacy — no PII in error reports
- Performance overhead must be minimal (especially in VS Code extension host)

## Scope Revision (User Feedback)

**Reduced scope**: Only 2 applications:

1. **ptah-electron** — Electron desktop app (main process only, skip renderer/Angular)
2. **ptah-license-server** — NestJS backend API

**Deferred**: VS Code extension (`ptah-extension-vscode`) and Angular webview (`ptah-extension-webview`) — will be tackled later.

## Strategy

- **Type**: FEATURE
- **Workflow**: Partial (Architect → Team-Leader → Developers)
- **Complexity**: Medium (2 runtimes, well-documented Sentry SDKs)

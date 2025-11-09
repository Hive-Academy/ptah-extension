# Task Context - TASK_PRV_002

## Original User Request

Week 5 Provider Angular UI Integration - Provider selection and health monitoring components

## Purpose

Create Angular webview components to surface provider selection, provider health status, and allow manual override. Integrate with `ProviderManager.state$` observable from backend and publish user-initiated provider switches via EventBus.

## Notes

- Depends on `TASK_PRV_001` provider core infra being completed (interfaces, strategy, manager, adapters).
- Target the Angular 20+ standalone component approach used across the webview.
- Keep components standalone, OnPush/Signals, and avoid NgModules.

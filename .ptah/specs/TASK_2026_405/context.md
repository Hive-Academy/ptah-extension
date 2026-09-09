# Context

## User intent

The notification in the Electron header must move out of the navbar. It must
render as a floating toaster near the top-right corner, close to its present
position, but not inside the navbar. The navbar must show no layout shift.

## Current implementation

- Host: `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:215`
  renders `<ptah-activity-ticker [items]="activity.recent()" [idle]="activity.isIdle()" (activate)="openThoth()" />`
  inside the navbar action cluster (`:212-222`). The navbar row is at `:92-223`.
- Presentation: `libs/frontend/chat-ui/src/lib/molecules/activity-ticker/activity-ticker.component.ts`
  — level dot at `:66`, message line at `:69-77`, `rotateMs` default 4000 at `:117`,
  rotation timer at `:158-162`.
- State: `libs/frontend/core/src/lib/services/back-office-activity.service.ts`
  — ring capacity 50 (`:71`), coalesce window 750 ms (`:74`), idle after 8000 ms (`:77`).
- Message source example: `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:202`.

## Notes for the implementer

- `libs/frontend/ui` has no toast or overlay host today. Do not build a general
  toast system for this task. A fixed-position element inside the Electron shell
  template is enough.
- CDK Overlay is not usable in the webview sandbox. The repository uses
  Floating UI based primitives in `libs/frontend/ui/src/lib/native/`.
- Keep `ActivityTickerComponent` presentational. Position belongs to the shell.
- Angular rules apply: standalone, signals, `OnPush`.

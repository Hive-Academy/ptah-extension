---
id: TASK_2026_187
status: done
type: REFACTORING
title: Webview initial bundle is 3.63 MB with nothing meaningfully lazy
description: ptah-extension-webview ships a 3.63 MB initial bundle (694 kB transfer) against lazy chunks totalling under 8 kB. Monaco, xterm, the editor lib and every inversion-token feature component are all eager because app.config.ts registers them at the root and the app deliberately has no Angular Router to lazy-load through. The production build began failing outright when the total crossed the 3.5 MB error budget; the ceiling was raised to 4 MB on 2026-08-09 to unblock, which buys headroom and fixes nothing. This task defers the heavy surfaces behind dynamic import so the number comes down instead of the budget going up.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-09T00:00:00.000Z
updated: 2026-08-09T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.

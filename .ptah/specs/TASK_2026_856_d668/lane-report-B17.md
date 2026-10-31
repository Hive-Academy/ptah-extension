# Batch B17 lane report

## Files changed

- `libs/frontend/chat/src/lib/settings/providers/connection-drawer/overview-tab.component.ts`
- `libs/frontend/chat/src/lib/settings/providers/connection-drawer/overview-tab.component.spec.ts`
- `libs/frontend/chat/src/lib/components/molecules/notifications/resume-notification-banner.component.ts`
- `libs/frontend/chat/src/lib/components/templates/electron-welcome.component.ts`
- `libs/frontend/chat/src/lib/components/templates/electron-welcome.component.spec.ts`

## Summary

- Overview tab: replaced its local interval and `NgZone` timer management with `injectWallClock('coarse', () => this.shownCheck() !== null)`. The existing age formatter consumes the shared clock. Spec checks a 30-second label change, coarse clock acquisition, and timer release when the record disappears or the component is destroyed.
- Resume banner: relative time reads the shared coarse clock; markup and copy remain unchanged.
- Electron welcome: recent workspace ages and the grid's local day read the shared coarse clock. Spec crosses local midnight in 30 seconds and checks both the recent age label and today's grid cell date.

## Lane check

`npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="overview-tab|electron-welcome" | Select-Object -Last 60` passed (exit 0). Last result lines:

```text
NX   1 task: 1 succeeded
Run duration:      13.8s
Cache:             0/1 hit (0%)
Critical path:     13.7s (1 task)
[verify 2026-10-30T21:56:09.286Z] lock released after 28.1s, exit code 0
```

`ptah_get_diagnostics` reported no errors in the five requested files. It also reported 264 errors in sibling files in the same project, outside B17 ownership; no sibling file was edited. The first diagnostics request timed out, then the cached retry returned this result.

## Decisions

- Use the conditional coarse clock only for the overview tab, because its record can disappear while the tab remains mounted. The banner and welcome screen use their always-active coarse clock while mounted. Options: conditional versus unconditional acquisition. Evidence: Component 13 plan, `injectWallClock` lifecycle, and existing ambient row consumer. Reversible: yes.
- Feed the welcome grid's local day from `localDayKey(new Date(coarse()))`; keep the ready history day supplied by `toGridView` from host activity data. Options: override all grid days versus use the existing view mapping. Evidence: `toGridView` uses its `today` argument only for non-history states and preserves the host's ready history day. Reversible: yes.

## Not done

- No visual screenshot: B17 marks UI review as unnecessary, and the permitted lane check excludes build or serve. No markup, labels, skeletons, or layout were changed.

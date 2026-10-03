VERDICT: APPROVED
Score: 9/10

## Scope reviewed

- `apps/ptah-electron-e2e/src/support/perf-session-fixture.ts:431-441` (new `.sidebar-scroll li:not([data-testid="session-group"])` selector)
- `libs/frontend/chat/src/lib/components/templates/app-shell.organization.spec.ts:158` (new `ClosedTabSessionEnderService` stub)
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:197-437` (template the selector must match)
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:169-172` (eager injection)
- grep of `apps/ptah-electron-e2e` and `libs/frontend/webview-e2e-harness` for other `role="list"`/`role="listitem"` selectors

## Finding 1 — spec stub is safe (OK)

`ClosedTabSessionEnderService` is injected into `AppShellComponent` solely to eagerly
instantiate the root singleton that ends backend sessions for closed tabs
(`app-shell.component.ts:169-172`). The organization spec exercises session-row
grouping (`sessionGroups()` / `groupSessionRows`), not tab-close behaviour. A
`useValue: {}` stub therefore hides no behaviour this spec relies on; the service's
own behaviour is covered by `closed-tab-session-ender.service.spec.ts`. Matches the
pattern already used by main's `app-shell.auth-redirect.spec.ts`.

## Finding 2 — new locator matches exactly the session row `<li>` (OK)

- Row `<li>` comes from the `#sessionRow` template at `app-shell.component.html:201-207`;
  it is the only `<li>` carrying session-row content.
- Group wrapper `<li data-testid="session-group">` (`:358-361`) is explicitly excluded
  by `:not(...)`, so a nested group's rows are matched individually, not via the group.
- `.sidebar-scroll` is unique in the template tree: exactly one occurrence across all
  `*.html` (`app-shell.component.html:197`).
- Within a row `<li>`, the first `button` in DOM order is the row's main session button
  (`:225`); rename (`:303`), delete (`:314`) and Organize (`:289`) come later, and chips
  render in a sibling `<div>` after the button (`:335-339`). So
  `getByRole('button').first()` still resolves to the row's main button.
  (Caveat: in inline-edit mode the row renders an `<input>` instead of the main button,
  so `.first()` would shift to the hover-action buttons — but the fixture always
  navigates to a non-editing row, same assumption the old `li[role="listitem"]` version made.)

## Finding 3 — skeleton/empty `<li>`s are nominally matched but filtered out (minor)

`<li class="p-1.5" role="presentation">` (skeleton, `:392`) and the empty-state
`<li role="presentation">` (`:400-402`) are also `.sidebar-scroll li` and are NOT
excluded by the `:not([data-testid="session-group"])` clause. They survive only because
`.filter({ hasText: name })` drops them (skeleton block and empty-state copy do not
contain the session name). If the empty-state copy ever echoes the searched name
(e.g. "No sessions matching '<input>'"), the locator would match two `<li>`s and
`.first()` could click the wrong one. Pre-existing weakness of `hasText` (substring
collisions between similarly named sessions), not a regression from this diff.

## Finding 4 — no other e2e selector depends on the session sidebar's removed roles (OK)

- `apps/ptah-electron-e2e/src/specs/git/diff-view-state.spec.ts:178` and
  `perf-m1-diff-redisplay.spec.ts:190` use `[role="listitem"]` on the git source-control
  file list, which still carries `role="listitem"` (`source-control-file.component.ts:54,176`).
- `apps/ptah-electron-e2e/src/showcase/marketplace-tour.scene.ts:173,179` targets
  `ptah-catalog-card[role="listitem"]` in the marketplace catalog, unaffected.
- `apps/ptah-electron-e2e/src/support/source-control.ts:32` uses `role="list"` on the
  source-control region, unaffected.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/monitor/agent-status.e2e.spec.ts:81`
  (`getByRole('listitem')`) binds to `background-agent-strip` rows, which still render
  `role="listitem"` (`background-agent-strip.component.ts:222`).
- The session sidebar itself no longer has any `role="list"`/`role="listitem"` anywhere,
  so no remaining selector can silently bind to it.

## Requirement fulfilment

| Check                                                  | Status                                         |
| ------------------------------------------------------ | ---------------------------------------------- |
| Spec stub cannot hide relied-upon behaviour            | COMPLETE                                       |
| New selector matches exactly the session row `<li>`    | COMPLETE                                       |
| Never matches a group wrapper                          | COMPLETE                                       |
| `.sidebar-scroll` unique                               | COMPLETE                                       |
| `getByRole('button').first()` is the row's main button | COMPLETE (with edit-mode caveat, pre-existing) |
| No other selector broken by role removal               | COMPLETE                                       |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: future `<li>` additions inside `.sidebar-scroll` (skeleton/empty states)
  rely on `hasText` filtering to stay excluded; a name echoed in empty-state copy would
  produce a wrong row match.

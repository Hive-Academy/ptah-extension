# Frontend implementation: `TASK_2026_719`, phase P5, batch F5 (page swap and card badge)

**Tasks completed**: plan §14 (page swap, card badge), plus the coordinator's request to wire the drawer's
`accountsAvailable` input (F4 added it to `connection-detail-drawer.component.ts`).

## Files (all paths relative to the worktree root, `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`)

- MODIFIED `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts`
  - Removed the `<ptah-accounts-section>` block, its import and its `imports[]` entry. The component files stay; F6 deletes them.
  - `ProviderAccountsStateService` and `ClaudeAmbientStatusService` are injected only when `accountsAvailable`
    (`VSCodeService.isElectron`). Outside Electron they are `null`, so no reads run and the services are never created.
  - `ngOnInit`: `accounts.open('claude')` and `ambient.read(false)` (D41 / P5-D10, cached read).
  - `closeDrawer()`: `accounts.refresh('claude')` and `ambient.read(false)` (D41 refresh on drawer close).
    Host pushes (`PROVIDER_ACCOUNTS_CHANGED`) update the state service, and the computed badge follows them.
  - `connectedAccounts = computed(() => connectedAccountCount(accounts.state('claude')(), ambient.view()))`.
    The card receives it only when `connectionKind(connection) === 'claude-cli'` (`isClaudeCli`), and `null` otherwise.
  - Drawer: `[accountsAvailable]="accountsAvailable"`.
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.spec.ts`. Adds the new describe
  block "named Claude accounts (P5 F5, D41)" with fake services (`signal` views and `jest.fn` reads) and a
  `VSCodeService` `{ isElectron }` stub.
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts`
  - `connectedAccounts = input<number | null>(null)`.
  - In the right-hand group, before "Used by": `@if (connectedAccounts(); as connected)` renders
    `<span class="badge badge-ghost badge-sm" data-testid="connected-accounts-badge">{{ connected }} connected</span>`.
    The badge is hidden for `null` and `0`. It is display only: no link, no label, no error.
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.spec.ts`. Adds the
  describe block "connected-accounts badge (D41)".

## Spec cases

Card:
- The badge is hidden for `null` and for `0`.
- `2` renders the span `2 connected`, with no `a` or `button` inside it and the `badge-ghost` class.
- The badge follows its input and hides again when the input returns to `null`.
- With a badge shown, activating the card still opens the drawer once.

Page (fakes hold two signed-in named accounts and one not-signed-in account):
- Electron:
  - The old `ptah-accounts-section` is not mounted.
  - When the page shows: `open('claude')` runs once and `read(false)` runs once, with no refresh.
  - The badge shows "3 connected" on the Claude CLI card only (one badge in the DOM, none on the api-key card).
    No account label appears on the card.
  - Ambient idle, checking, transport failure and host `unknown` each hide the badge (`it.each`).
  - Ambient `signed-out` shows "2 connected"; `connected` shows "3 connected".
  - With 0 connected the badge is hidden.
  - The badge is hidden while the account list is loading, while a refresh is in flight with the data kept, after
    an error, and while the list is stale.
  - Recovery: after a transport failure, a `connected` reply restores "3 connected".
  - A pushed snapshot that signs one account out shows "2 connected".
  - The drawer receives `accountsAvailable === true`. Closing it with its Close button calls `refresh('claude')`
    once and `read(false)` a second time.
- Inert host (not Electron): no `open`, `state` or `read` calls and no badge. The drawer receives
  `accountsAvailable === false`, and closing it makes no reads.

## Verification

- `node D:/projects/ptah-extension/scripts/verify.mjs --exec --task f5-jest -- npx jest -c libs/frontend/chat/jest.config.ts <the 2 specs>`
  returned **Test Suites: 2 passed, 2 total; Tests: 123 passed, 123 total**.
- `ptah_get_diagnostics` on the 4 files reported no diagnostics in the requested files. It reported errors in
  sibling chat spec files, for example `agent-card-truncation.spec.ts` and `compact-session-card.component.spec.ts`,
  which F5 did not touch.
- Not run, per the brief: lint, `npm run verify`, and typecheck through Nx. The team-leader runs those for F5:
  `-p @ptah-extension/chat,ptah-extension-webview,ptah-electron,ptah-extension-vscode`.
- No new `as unknown as`, `any`, `console.*`, `process.cwd()` or `jest.spyOn` on module namespaces. The new
  spec reads the drawer through `drawer.injector.get(ConnectionDetailDrawerComponent)`.

## Plan deviations

- None in behaviour.
- Implementation detail: the services are injected conditionally (`accountsAvailable ? inject(X) : null`) rather
  than always. This keeps the earlier guarantee that the account state owner is never created outside Electron,
  and the "inert host makes no reads" case falls out structurally.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Inject the account and ambient services only in Electron | Always inject and rely on the services' own inert gates; conditional inject | The old page comment "elsewhere the section and its state owner are never created" (D34); plan §14 "inert host makes no reads" | yes |
| Place the badge before "Used by N" in the right-hand group | Before or after "Used by" | Plan §14 names only the right-hand group (`:116-126`). The count of accounts sits next to the connection's other status counts | yes |
| Re-read on every drawer close, whichever connection was open | Only after closing the Claude CLI drawer; every close | Plan §14 states `closeDrawer()` without a kind filter. The reads are cheap: the ambient read is cached (P5-D10) and the list read is a single RPC | yes |

## Open points for F6 and F7

- F6 can now delete `accounts/accounts-section.component.ts` and its spec. The page no longer imports them, and no
  other importer was touched here. F6 should confirm with a search before deleting.
- The class `ProviderAccountsStateService` is still injected by name on the page. The §15 state-service cleanup
  (F7, frontend `setDefault`) must keep `open`, `refresh` and `state(provider)`, which the page uses.
- Visual check (Electron, dark and light) of the `badge-ghost badge-sm` badge on the Claude (Subscription) card is
  still open. No screenshot was taken in this batch.

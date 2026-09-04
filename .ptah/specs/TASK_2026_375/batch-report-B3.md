# TASK_2026_375 — Batch report B3

**Batch**: B3 — Ptah connectors catalog + Connectors surface
**Libs**: `libs/shared`, `libs/frontend/marketplace`, plus ONE live-probe spec in
`libs/backend/cli-agent-runtime`
**Status**: complete.

---

## Files changed

| File                                                                            | Part | Change                                                                                                                                                       |
| ------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libs/backend/cli-agent-runtime/.../oauth/ptah-connectors-catalog.live.spec.ts` | B3.1 | **NEW.** The live OAuth-discovery probe. `describe.skip` unless `PTAH_LIVE_PROBES=1`. 197 lines.                                                             |
| `libs/shared/src/lib/connectors/ptah-connectors.catalog.ts`                     | B3.1 | **NEW.** `PtahConnectorKind`, `PtahConnectorCategory`, `PTAH_CONNECTOR_CATEGORIES`, `PtahConnector`, `PTAH_CONNECTORS` (21 entries), plus two label helpers. |
| `libs/shared/src/lib/connectors/ptah-connectors.catalog.spec.ts`                | B3.1 | **NEW.** 20 shape-validation cases.                                                                                                                          |
| `libs/shared/src/index.ts`                                                      | B3.1 | One barrel line: `export * from './lib/connectors/ptah-connectors.catalog';`                                                                                 |
| `libs/frontend/marketplace/src/lib/connectors-surface.component.ts`             | B3.2 | **NEW.** The Connectors surface. 702 lines.                                                                                                                  |
| `libs/frontend/marketplace/src/lib/connectors-surface.component.html`           | B3.2 | **NEW.** Its template (`templateUrl`, matching the hub's precedent). 251 lines.                                                                              |
| `libs/frontend/marketplace/src/lib/connectors-surface.component.spec.ts`        | B3.2 | **NEW.** 33 cases.                                                                                                                                           |
| `libs/frontend/marketplace/src/lib/providers.registry.ts`                       | B3.2 | New `connectors` descriptor, placed FIRST, label **Connectors**, icon `Plug`.                                                                                |
| `libs/frontend/marketplace/src/lib/smithery-surface.component.ts`               | B3.2 | Account row, Connections list, reusable API-key form, connection-aware Installed badge, four new methods, four new signals.                                  |
| `libs/frontend/marketplace/src/lib/smithery-surface.component.spec.ts`          | B3.2 | New `account + connections` describe, 12 cases. Every pre-existing case kept and still passes.                                                               |
| `libs/frontend/marketplace/src/index.ts`                                        | B3.2 | Barrel exports for `ConnectorsSurfaceComponent` and its two types.                                                                                           |

No file outside the batch scope was touched. No git state command was run.
`libs/shared/src/lib/types/execution/stream-background.ts`,
`sdk-hook.parsers.ts`, `sdk-hook.types.ts` and `sdk-hook.parsers.spec.ts` show as
modified in this working tree — they belong to the other engineer, not to this
batch.

---

## Live probe table

Command (run once, from the repository root):

```
PTAH_LIVE_PROBES=1 npx jest --config libs/backend/cli-agent-runtime/jest.config.ts \
  --testPathPatterns="ptah-connectors-catalog.live" --runInBand
```

Result: **19 of 20 candidates passed.** `kind` is set from the presence of
`registration_endpoint` in the RFC 8414 metadata document.

| id              | url                                 | result | kind      | authorization server / reason                                                                                                   |
| --------------- | ----------------------------------- | ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| sentry          | https://mcp.sentry.dev/mcp          | PASS   | oauth-dcr | https://mcp.sentry.dev                                                                                                          |
| notion          | https://mcp.notion.com/mcp          | PASS   | oauth-dcr | https://mcp.notion.com                                                                                                          |
| linear          | https://mcp.linear.app/mcp          | PASS   | oauth-dcr | https://mcp.linear.app                                                                                                          |
| hubspot         | https://mcp.hubspot.com             | PASS   | oauth-app | https://mcp.hubspot.com                                                                                                         |
| atlassian       | https://mcp.atlassian.com/v1/mcp    | PASS   | oauth-dcr | https://mcp.atlassian.com                                                                                                       |
| asana           | https://mcp.asana.com/sse           | PASS   | oauth-dcr | https://mcp.asana.com                                                                                                           |
| intercom        | https://mcp.intercom.com/mcp        | PASS   | oauth-dcr | https://mcp.intercom.com                                                                                                        |
| stripe          | https://mcp.stripe.com              | PASS   | oauth-dcr | https://access.stripe.com/mcp                                                                                                   |
| paypal          | https://mcp.paypal.com/mcp          | PASS   | oauth-dcr | https://mcp.paypal.com                                                                                                          |
| square          | https://mcp.squareup.com/sse        | PASS   | oauth-dcr | https://mcp.squareup.com                                                                                                        |
| canva           | https://mcp.canva.com/mcp           | PASS   | oauth-dcr | https://mcp.canva.com                                                                                                           |
| figma           | https://mcp.figma.com/mcp           | PASS   | oauth-dcr | https://api.figma.com                                                                                                           |
| vercel          | https://mcp.vercel.com              | PASS   | oauth-dcr | https://vercel.com                                                                                                              |
| neon            | https://mcp.neon.tech/mcp           | PASS   | oauth-dcr | https://mcp.neon.tech                                                                                                           |
| supabase        | https://mcp.supabase.com/mcp        | PASS   | oauth-dcr | https://api.supabase.com                                                                                                        |
| zapier          | https://mcp.zapier.com/api/mcp/mcp  | PASS   | oauth-dcr | https://mcp.zapier.com                                                                                                          |
| monday          | https://mcp.monday.com/mcp          | PASS   | oauth-dcr | https://auth.monday.com/mcp                                                                                                     |
| webflow         | https://mcp.webflow.com/sse         | PASS   | oauth-dcr | https://mcp.webflow.com                                                                                                         |
| cloudflare-docs | https://docs.mcp.cloudflare.com/mcp | FAIL   | —         | `No OAuth authorization-server metadata found for https://docs.mcp.cloudflare.com. The server may not support OAuth discovery.` |
| github          | https://api.githubcopilot.com/mcp/  | PASS   | oauth-app | https://github.com/login/oauth                                                                                                  |

**Cloudflare docs is the one exclusion and it is committed as excluded.** The
server publishes no authorization-server metadata because it needs no
authorization at all — it is a public documentation server. It belongs on the
MCP Registry surface, not in a connectors catalog. One catalog case asserts its
URL is absent, so a future hand-edit that re-adds it fails the suite.

Two entries came back `oauth-app`, and both are correct rather than a probe
weakness. HubSpot is already documented in `oauth-surface.component.ts` as the
canonical pre-registered-app provider. GitHub's authorization server is
`https://github.com/login/oauth`, which has never supported RFC 7591 dynamic
registration.

### Smithery entries — verified separately

The two `smithery` entries carry no URL, so the OAuth probe does not apply to
them. Both qualified names were confirmed against the public registry, which
answers `GET https://registry.smithery.ai/servers/{qualifiedName}` without a key:

| qualifiedName | HTTP | displayName | remote | deploymentUrl               |
| ------------- | ---- | ----------- | ------ | --------------------------- |
| `hubspot`     | 200  | HubSpot     | true   | `https://hubspot.run.tools` |
| `exa`         | 200  | Exa Search  | true   | `https://exa.run.tools`     |

`exa` is the second entry the batch asked for. It was chosen over a second CRM
because it adds a capability the OAuth entries do not cover (web search and page
crawling) rather than duplicating one.

### Committed catalog

21 entries: 17 `oauth-dcr`, 2 `oauth-app`, 2 `smithery`. Every one passed its
probe. `verifiedAt` is `2026-09-03` on all of them, held in one `VERIFIED_AT`
constant so a re-probe is a one-line edit.

---

## Decisions

1. **The live probe lives in `cli-agent-runtime`, not in `libs/shared`.** As the
   batch instructed. `libs/shared` must not import a backend lib, and the probe
   needs `discoverAuthorizationServer` / `discoverAuthServerMetadata` from
   `./mcp-oauth-metadata`. The catalog's module comment points at the probe by
   path so the link is not lost.

2. **The probe suite is TWO describes, not one.** The live describe is skipped
   without the flag; a second, always-on describe pins the gate itself, so an
   ordinary CI run proves it made no network call rather than silently passing
   an empty file. This is why `cli-agent-runtime` reports one skipped test in
   the verification run below.

3. **`ConnectorStatus` is four values, not the union of the two wire enums.**
   The card has exactly three actions, so it needs exactly the states that pick
   between them. `McpOAuthConnectionState` `'expired'` and `'disconnected'`, and
   every non-`connected`, non-`error` `SmitheryConnectionStatus`, all mean the
   same thing to the user — listed but will not answer — and all map to
   `needs-auth` with an Authorize button. Only Smithery's explicit `error` gets
   its own branch, because it is worth naming on the card.

4. **`oauth-app` Connect does NOT call `connectOAuth`.** There is no client id
   yet for the call to use, so it would fail on every one of the two `oauth-app`
   entries. Connect opens the embedded custom-server form pre-filled with the
   URL, the label, and Advanced already expanded — which is exactly where the
   client id and secret go. A spec pins that `connectOAuth` is not called.

5. **The custom-server form is the real `OAuthSurfaceComponent`, mounted
   unconditionally inside a collapsed `<details>`.** The batch says reuse it, do
   not duplicate it. Keeping it mounted (rather than behind an `@if`) is what
   lets an `oauth-app` Connect fill it in through a `viewChild` without waiting
   for a mount. The cost is one extra `listOAuthConnected` plus its per-server
   `oauthStatus` reads on the child's own init; the benefit is that the child
   emits `serverConnected` / `serverDisconnected`, which the surface listens to
   and uses to re-run its own merge.

6. **URL matching normalizes the trailing slash and the host case.** The catalog
   holds `https://api.githubcopilot.com/mcp/` while a manifest record may hold
   it without the slash, or the reverse. A spec pins the trailing-slash case.

7. **Connect for a `smithery` entry opens the setup page through
   `openSmitherySetup`, not through the `setupUrl` the install returned.** B2
   established that a setup URL is single use and that `openSmitherySetup`
   re-creates the connection to mint a fresh one. Using the install's URL would
   hand the user a stale credential the moment they hesitate.

8. **The setup poll stops on `error`, not only on `connected`.** The batch asked
   for "every 3 s for up to 5 min until connected". Polling a state Smithery has
   already called terminal for the remaining minutes buys nothing and keeps a
   spinner on a card that will never change. The poll therefore ends on
   `connected`, on `error`, at the 5-minute deadline, and on destroy. A
   **transient RPC failure is explicitly not a verdict**: the poll keeps its slot
   and retries on the next tick. All five behaviours are pinned by specs.

9. **A load failure is only a load failure when BOTH sources fail.** The OAuth
   manifest and the Smithery Connections API are independent. A user with no
   Smithery API key must still see accurate OAuth badges, so `loadError` is set
   only when neither half answered. A `listSmitheryConnections` result that
   carries its own `error` (no key, revoked key) renders as "not connected", not
   as a broken surface.

10. **Disconnect is withheld for a Smithery connection Ptah did not create.**
    `SmitheryConnectionSummary.managedByPtah` is false for a connection the user
    made in Smithery directly, and such a connection has no Ptah `serverKey` to
    address. Deleting it would destroy work Ptah does not own. The card says so
    and the button is disabled; Authorize on the same card explains instead of
    acting. Two specs pin that no RPC is fired in either case.

11. **A failed `openSmitherySetup` does NOT re-read the connection list.** Found
    by a spec that expected the error message and got `null`: the reload
    succeeded and overwrote the very message the user has to act on. Nothing
    changed upstream when the open failed, so there is nothing to re-read.
    Fixed in `smithery-surface.component.ts`.

12. **The Smithery API-key form is now ONE block serving two callers.** The
    Account row's "Change key" button needed the same form the not-configured
    branch already had. Rather than duplicate the markup, the template branch
    became `keyStatus() === 'not-configured' || showKeyForm()`. A successful save
    clears `showKeyForm`, so the row collapses on its own.

13. **The installed badge reads the CONNECTION, not the manifest.** This is the
    defect the user reported: HubSpot showed "Installed" while the session
    reported `needs-auth`. `installedBadge(qualifiedName)` resolves through
    `connectionStatusOf`, and falls back to the old "Installed" wording only for
    a legacy record with no connection behind it. Both routes are pinned.

14. **The `connectors` descriptor needed no hub edit.** The hub's
    `isGenericSurface()` already mounts any descriptor whose surface is not one
    of the three special-cased components, passing `refreshTrigger` through
    `NgComponentOutlet`. Placing the descriptor first in
    `MARKETPLACE_PROVIDERS` is the whole change. Connected Apps stays as its own
    descriptor, as the batch requires.

---

## Verification

```
npx nx run-many -t typecheck lint test -p @ptah-extension/shared @ptah-extension/marketplace @ptah-extension/cli-agent-runtime --skip-nx-cache
```

Header: `NX  Running targets typecheck, lint, test for 3 projects:`
Result: `NX  Successfully ran targets typecheck, lint, test for 3 projects`

Project names were read from each `project.json` first:
`@ptah-extension/marketplace` (`libs/frontend/marketplace/project.json`),
`@ptah-extension/shared`, `@ptah-extension/cli-agent-runtime`.

| Project                             | Test suites    | Tests                           | Typecheck | Lint                                   |
| ----------------------------------- | -------------- | ------------------------------- | --------- | -------------------------------------- |
| `@ptah-extension/shared`            | 53 passed / 53 | **1258 passed / 1258**          | clean     | clean                                  |
| `@ptah-extension/marketplace`       | 11 passed / 11 | **225 passed / 225**            | clean     | 3 problems, **0 errors**, 3 warnings   |
| `@ptah-extension/cli-agent-runtime` | 48 passed / 48 | **632 passed, 1 skipped / 633** | clean     | 36 problems, **0 errors**, 36 warnings |

### Deltas against the B2 baseline

| Project             | B2 baseline | B3 measured | Delta                                      |
| ------------------- | ----------- | ----------- | ------------------------------------------ |
| `shared`            | 52 / 1238   | 53 / 1258   | +1 suite, **+20 cases**                    |
| `cli-agent-runtime` | 47 / 631    | 48 / 633    | +1 suite, **+2 cases** (1 of them skipped) |
| `marketplace`       | 10 / 180 \* | 11 / 225    | +1 suite, **+45 cases**                    |

\* measured in this working tree before the batch started; B2 did not run
`marketplace`.

**Cases added by this batch: 65** (20 + 12 + 33).

| Spec file                              | Cases | Notes                                                                     |
| -------------------------------------- | ----- | ------------------------------------------------------------------------- |
| `ptah-connectors.catalog.spec.ts`      | 20    | **NEW file.** Shape validation.                                           |
| `ptah-connectors-catalog.live.spec.ts` | 2     | **NEW file.** 1 live (skipped without the flag) + 1 always-on gate check. |
| `connectors-surface.component.spec.ts` | 33    | **NEW file.** Filter, merge, routing, authorize, disconnect, poll.        |
| `smithery-surface.component.spec.ts`   | 12    | New `account + connections` describe.                                     |

### Lint detail

Every lint warning is `max-lines` or a pre-existing rule in a file this batch did
not create:

- `cli-agent-runtime` — 36 warnings, identical to the B2 report's 36. Grepping
  the output for `ptah-connectors` returns nothing: the new probe spec adds no
  warning.
- `marketplace` — 3 `max-lines` warnings:
  `external-marketplaces.component.ts` (753) and `oauth-surface.component.ts`
  (722) are untouched and pre-existing. `smithery-surface.component.ts` grew from
  1152 to 1262 lines; it was **already 452 lines over the warn ceiling before
  this batch**. See the note below.
- The two new component files draw no warning:
  `connectors-surface.component.ts` is 702 lines with its template in a separate
  `.html`, following the `marketplace-hub.component` precedent.

---

## Not done / notes for later batches

- **`smithery-surface.component.ts` is now 1262 lines and I did not split it.**
  The batch asked for the Account row and the Connections list inside this
  component, and both are there. The file was already at 1152 lines and already
  warning before B3, so the split is pre-existing work, not work this batch
  created. The cheap, behaviour-preserving fix is to move its inline template to
  `smithery-surface.component.html`, exactly as
  `marketplace-hub.component` and the new `connectors-surface.component` do —
  that alone takes the TS file to roughly 450 lines and clears the warning
  without touching a single method. I left it undone deliberately rather than
  widen the batch; recommend it as its own small task.

- **The `github` catalog entry's URL contains a trademarked AI product name**
  (`api.githubcopilot.com`). Per the root `CLAUDE.md` marketplace rule this is
  safe: the catalog is a TypeScript source file that compiles into `main.mjs` and
  the webview chunks, and the scanner only rejects those names in **non-JS**
  files. Nothing about this entry reaches a markdown or JSON asset. Flagging it
  so nobody later copies the URL into a docs page without thinking. **B5 in
  particular must not paste this URL into
  `apps/ptah-docs/src/content/docs/marketplace/connectors.md`.**

- **No `docsUrl` is set on any entry.** The field exists in `PtahConnector` and
  the spec validates it when present, but I did not invent provider
  documentation URLs I had not probed. Populate it in a later pass with the same
  discipline the catalog uses for `url`: probe, then commit.

- **B4 consumers**: the chat MCP chip can reuse `ptahConnectorKindHint()` and
  `PTAH_CONNECTORS` to name a server key the session reports. Remember the note
  from the B2 report — a Connections-API install appears in the session as ONE
  server named `smithery`, so the chip's Authorize routing for that key should
  open the Marketplace Smithery surface, where the new Connections list now shows
  a per-connection status and a per-connection Authorize button.

- **B5 docs**: `connectors.md` needs the three `kind` values, the four status
  badges (Connected / Needs authorization / Error / Not connected), the
  "Connect a custom server" disclosure, and the fact that the Connectors tab is
  now first in the Marketplace. The Smithery page needs the Account row, the
  Connections list, and the reason the Installed badge can now read "Needs
  authorization".

- **The catalog is a point-in-time snapshot.** Re-run the live probe before
  editing it. A provider that adds a `registration_endpoint` moves from
  `oauth-app` to `oauth-dcr`, and the Connect routing changes with it.

- Nothing was committed.

# Batch 21 report: drawer Credentials tab

Executor: Providers owner (in-process frontend-developer). Nothing committed, no git stash / restore / checkout / reset / clean. No
`libs/frontend/ui`, `libs/frontend/core` or `libs/shared` edits. Worktree `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign`,
on top of 36384ace1.

## Files

- CREATED `libs/frontend/chat/src/lib/settings/providers/connection-drawer/credentials-tab.component.ts` (474 lines) and its `.spec.ts`: the
  tab, `replaceKeyDraft()` and the fixed failure copy.
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/connection-detail-drawer.component.ts` (249 lines) and its `.spec.ts`: mounts the
  tab, builds the Replace draft, and decides where "Edit in setup" stays.
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts` (661 lines, under 700):
  - wires the drawer writes;
  - adds `drawerCommit`;
  - reads the connection setup on open;
  - Manage is no longer hidden for `anthropic`.
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.spec.ts`. This spec is not in the batch file list. The
  parent-level acceptance (connectProvider draft, D15 ownership, refusal) can only be tested there. `StateStub` gains `deleteStoredKey` and
  `disconnectCopilot`.
- MODIFIED `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts`: flips and new entries, listed
  below.
- MODIFIED `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-visual.e2e.spec.ts`: adds two Credentials captures.

## Orchestrator decisions applied

- **Latency in the Overview status: not shown.**
  - The route read (`EffectiveRouteProvider`, `rpc-auth.types.ts:214-241`) carries no latency.
  - The only existing per-probe latency is `AuthVerifyDraftConnectionResult.latencyMs` (`rpc-auth.types.ts:516`). It belongs to a draft
    probe. `state.verification()` holds only the latest probe, keyed by `probeId`, not by connection.
  - Showing it in Overview would present a draft key's check as the stored connection's status, so it is kept out. No new contract was
    added.
  - The draft-probe latency **is** shown where it is honest: in the Credentials Replace check ("Key verified (92ms)", "Check failed (80ms)").
- **Key hint: not implemented.** A stored key shows the fixed mask `••••••••••••••••` (`credentials-tab.component.ts:176`). No part of the
  key crosses RPC. This is a flagged deviation for the user at Gate V (Batch 28).

## Acceptance item → file:line → spec

Unless marked otherwise, `CT` is `credentials-tab.component.ts`, its spec is the Credentials tab spec, `PS` is the Providers settings spec,
and `DD` is the detail drawer spec.

| Acceptance | Implementation | Spec |
|---|---|---|
| Key input clears on destroy | `CT:376` `DestroyRef.onDestroy(resetReplace)`. Also cleared on Cancel, on a saved Replace (`CT:372-374`), and when another connection opens (`CT:365-370`, keyed on the id via `connectionId` `CT:310`, so a refresh does not wipe it). A running check is cancelled (`abandonProbe`). | "Cancel and destroy drop the typed key and cancel a running check"; "opening another connection drops the typed key and any open confirm" |
| Replace = verify-then-save via `connectProvider({activation:'connect-only'})` | Check: `CT:394` `verify()` calls the parent's existing `verifyDraftConnection` (the wizard's callback). Save: `CT:338` `canSave` is enabled only for a verified result of the current `probeId`. Draft: `replaceKeyDraft` `CT:46`, built in the drawer (`emitReplace`, drawer `:238`). Write: `providers-settings.component.ts:514` → `state.connectProvider`. | `replaceKeyDraft` specs (3); "Save stays disabled until the typed key passed a check; a verified key saves once"; "editing the key after a pass needs a new check"; PS "Replace saves through connectProvider, connect-only, with the verified probe and the stored tiers" |
| Failed verify: Save disabled, reason and latency shown, nothing persisted | `CT:340-350` `probeText`: fixed reason copy (`PROBE_FAILURE_COPY` `CT:62`), never the host `detail`; "(Nms)"; "Nothing was saved." Save stays disabled and no event is emitted. A rejected check call reads as failed. | "a failed check leaves Save disabled, shows the reason and latency, and asks for nothing to be saved"; "a rejected check call is shown as a failed check, never as verified"; harness RUX-1 (INVALID_PROBE_KEY → Save disabled) |
| `anthropic` Replace rule (plan :649-652) | `CT:334` `anthropicGuidance`: Replace only while Claude API drives the main agent. Otherwise it shows "Connect provider" guidance. The draft uses `use-main-agent` for `anthropic` (`CT:58`), and the form says saving restarts chat sessions. | "offers Replace only while Claude API drives the main agent, and says saving restarts sessions"; "the Claude API key is stored through activation" |
| Delete key → `deleteStoredKey`, inline confirm, active-driver warning (#7/#8) | `CT:233-249` confirm; `CT:238` warning "… drives the main agent. New requests fail until a key is added."; `CT:428` emit. Write: `providers-settings.component.ts:507` → `state.deleteStoredKey(id, context)`. | "asks inline before deleting, and warns when this connection drives the main agent"; "no active-driver warning … Cancel deletes nothing"; "is disabled while a save is in flight"; DD "relays the Credentials tab requests"; harness #7 (anthropic), #8 (moonshot) |
| Copilot Sign out → `disconnectCopilot` (#12) | `CT` copilot view (account label, Sign out, inline confirm); `CT:434` emit. Write: `providers-settings.component.ts:510` → `state.disconnectCopilot(context)`. | "GitHub Copilot shows the account and signs out after an inline confirm (#12)"; harness #12 |
| Codex copy (#13) | `CT:150` token-stale vs signed-in copy naming `~/.codex/auth.json`; Open login → `externalAction(id, 'sign-in')` (existing `performExternalAuth`). | "OpenAI Codex shows token-expired copy and Open login (#13)"; harness RUX-10 |
| claude-cli copy (#10) | `CT` cli view: `claude login` and `npm install -g @anthropic-ai/claude-code`, each with Copy (`CT:106`); "Check again" → `cli-check`. | "Claude CLI shows the login and install commands with Copy, and Check again (#10)"; harness RUX-10 |
| Ollama Cloud copy (#15), Get a key (#9/#20) | `CT:194` optional-key explanation (registry `supportsOptionalApiKey`); `CT:200` registry `helpUrl` (https only, `rel="noopener noreferrer"`). | "Ollama Cloud explains its optional key and links to the provider (#15, #9)" |
| Show/hide (#49) | `CT:213` eye toggle, `aria-pressed`, password ↔ text on the Replace field. | "show/hide toggles the new key field between password and text (#49)"; harness #49 |
| D15, never "Saved" after a failure | Tab: `CT:352-362` `commitView` shows "Key replaced." / "Stored key deleted." / "Signed out." only for `saved`. `unconfirmed` shows "Save not confirmed"; failed/partial/blocked show "Not saved. {fixed message}" as `role="alert"`. Parent: `drawerWrite` `providers-settings.component.ts:521-531` sets `saving`, and copies `state.commit()` only after ITS write resolved, so an earlier page save never shows. A refused write (`false`) reads "Another save is in progress". | "a saved Replace closes the form … a failure keeps it and says Not saved (D15)"; PS "never reports Saved after a failed write, nor for an earlier save (D15)"; PS "a write refused because another save runs says so instead of Saved" |
| "Edit in setup" fallback (D14) | Drawer `:66` `CREDENTIALS_COMPLETE` = api-key, oauth, claude-cli: their Credentials tab holds every credential path, so the footer has Close only. **Kept** for `local` (base URL, optional key) and `custom` (base URL/protocol → Advanced, Batch 22): `setupFallback` `:227-230`. Models & Tiers and Advanced keep it (Batch 22). | DD "Credentials of %s holds every credential path: the tab body, no setup fallback" (api-key, claude-cli); DD "the Overview footer has Close only …" (custom keeps it on Credentials/Models/Advanced) |
| Reachability flips | `settings-reachability.table.ts`:<br>- #7 `:814`, #8 `:820`, #12 `:829`, #49 `:844` → `restored` with real reaches.<br>- New RUX-1 `:870`, RUX-4 `:890`, RUX-10 `:896` (`restored`).<br>- `EXPECTED_CAPABILITY_COUNT` 81 → 84 (`:952`; grows only).<br>- `setupThroughDrawer` (`:279`) now goes through Models & Tiers, because api-key/cli/oauth Credentials no longer offers setup. | Gate G below |

## Write-path trace (control → state method → RPC → store key / scope → runtime reader)

1. **Credentials → Check key.**
   - Chain: `CT verify()` → parent `verifyDraftConnection` (`providers-settings.component.ts`, the wizard's callback) →
     `state.verifyDraft` → `auth:verifyDraftConnection` (`auth-rpc.handlers.ts:1622`).
   - Params: `{providerId, authMode, credential:{kind:'apiKey'}, baseUrl?}`.
   - Store: **none**. The probe is transient; the host never persists the draft credential (`rpc-auth.types.ts:485-492`).
   - Reader: `verifiedProviderId` in `providers-connection-setup.service.ts:282`, the gate `connectProvider` checks.
2. **Credentials → Save key (third-party, custom).**
   - Chain: `CT save()` → drawer `emitReplace` → `replaceKeyDraft` → parent `replaceKey` → `drawerWrite` → `state.connectProvider(draft)`.
   - `providers-connection-setup.service.ts:171-174` → `auth:setApiKey {provider, apiKey}` (`auth-rpc.handlers.ts:1240`).
   - Store: `ptah.auth.provider.<id>` in SecretStorage (plan §3). There is no tier write (`editedTiers: []`), no custom-entry write (a custom
     id is sent as `apiKey` mode), no base-URL write (`baseUrl: null`) and no activation (`connect-only`).
   - Reader: the api-key strategy at the next configure (`api-key.strategy.ts:657-690`, plan §3). No reset.
3. **Credentials → Save key (`anthropic`, only while it drives the main agent).**
   - Chain: same, with `activation:'use-main-agent'` → `activationAuth` (`providers-connection-setup.service.ts:246-249`) →
     `auth:saveSettings {authMethod:'apiKey', anthropicApiKey, applyTo:'global'}` (`auth-rpc.handlers.ts:932`).
   - Store: the Anthropic API credential in SecretStorage, plus `authMethod` in `~/.ptah/settings.json`, global.
   - Reader: `active-provider-resolver.ts:25-42`.
   - **Ends live sessions** (SDK reset, plan §3 row 1). The form says so before Save.
4. **Credentials → Delete key → confirm.**
   - Chain: `CT confirmDelete()` → drawer relay → parent `deleteKey(id)` → `drawerWrite` → `state.deleteStoredKey(id, context)`
     (`providers-connection-setup.service.ts:307-314`) → `auth:deleteStoredKey {providerId}` (`auth-rpc.handlers.ts:1284`, D4).
   - Store: `ptah.auth.anthropicApiKey` (for `anthropic`) or `ptah.auth.provider.<id>`, SecretStorage. No auth-method write, no SDK reset.
   - Read-back: `auth:getAuthStatus.hasApiKey` / `auth:getApiKeyStatus`.
   - Reader: the same strategies at the next configure. For the active driver, the route then shows needs-key; the confirm warns about this.
5. **Credentials → Copilot Sign out → confirm.**
   - Chain: `CT confirmSignOut()` → parent `signOutCopilot()` → `state.disconnectCopilot(context)`
     (`providers-connection-setup.service.ts:316-321`) → `auth:copilotLogout` (`auth-rpc.handlers.ts:1161`).
   - Store: `provider.github-copilot.loggedOut = true` (plan §3).
   - Read-back: `auth:getAuthStatus.copilotAuthenticated !== true`.
   - Reader: the Copilot auth service. The in-flight proxy effect is unverified, as recorded in plan §3.
6. **Credentials → Open login / Check again.**
   - Chain: `CT externalActionRequested` → parent `externalAction(id, 'sign-in' | 'cli-check')` → `state.performExternalAuth`
     (`providers-connection-setup.service.ts:93-133`) → `auth:codexLogin` or `auth:copilotLogin`, then `auth:getAuthStatus`.
   - Store: the host's own login files (Codex `~/.codex/auth.json`). Ptah writes no setting.
   - Reader: the connections read (`codexAuthenticated` / `codexTokenStale`).
7. **Reads added:**
   - Opening the drawer calls `state.refreshConnectionSetup(id)` (`providers-settings.component.ts:504`), which reads `llm:getProviderBaseUrl`
     and `provider:getModelTiers {scope:'mainAgent'}`.
   - Its tiers go into the Replace draft unchanged, which satisfies `connectProvider`'s models check (`:182`) without editing a tier.
   - Its `baseUrl` is the endpoint a custom key is checked against.

## Verification

1. `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview --parallel=2`
   exited 0 ("Successfully ran targets typecheck, test, lint for 5 projects"). Log: `C:\Users\abdal\AppData\Local\Temp\b21-verify.log`.
   - Tests: core 1083/1083; ui 610/610; chat 1806 passed + 2 skipped (1808; +29 over Batch 20); ptah-extension-webview 224/224. Harness
     typecheck (tsc) passed.
   - Lint: 0 errors. Warnings (core 11, chat 31, harness 41) are unchanged from Batch 20, and none are in the changed files.
2. Gate G: `npx nx build ptah-extension-webview` exited 0 (log `C:\Users\abdal\AppData\Local\Temp\b21-gateg-build.log`).
   - The initial bundle is 3.49 MB, the same as Batch 20.
   - A first build went over the 3.5 MB error budget (3.51 MB). The cause was the page importing `replaceKeyDraft` eagerly, which pulled the
     tab out of the drawer's `@defer` chunk. Fixed by building the draft inside the drawer; the page now has only a type import
     (`providers-settings.component.ts`, comment at the import).
   - Then `settings-reachability.e2e.spec.ts --reporter=list --repeat-each=3` gave **27 passed** (1.3m), exit 0. Log:
     `C:\Users\abdal\AppData\Local\Temp\b21-gateg.log`. The flipped #7, #8, #12, #49 and the new RUX-1/-4/-10 run in both hosts.
   - An earlier single run (log `b21-gateg-try.log`) also gave 9/9. Nothing else built `dist/` during the runs.
3. Captures: `settings-visual.e2e.spec.ts` gave **4 passed**, exit 0 (log `C:\Users\abdal\AppData\Local\Temp\b21-visual.log`).
   - New files: `current-drawer-moonshot-credentials-*` and `current-drawer-claude-cli-credentials-*` (vscode/electron × anubis/anubis-light).
   - `git status --short -- .ptah/specs/TASK_2026_555/screenshots/angular/baseline-*` is **empty**.

## Capture comparison (vs `prototypes/final/index.html` Credentials markup; no prototype screenshot of this tab exists)

- **Moonshot, api-key (both hosts, both themes):** matches Mode B.
  - "Stored API key" label, then the masked field, Replace (outline) and Delete key (outline, error-tone border; the text stays
    base-content, deviation 6) on one row. "Get a key →" below (the prototype's help line). Then a Storage row: "Encrypted on this machine".
  - The prototype's mask is a read-only password `input` with an eye toggle. Ours is a read-only text span with a fixed mask. Show/hide is
    on the Replace field, where there is a real value to reveal (#49), because the stored key is never sent to the webview.
  - Replace opens an inline form (key field with eye toggle, Check key, Save key, Cancel), where the prototype uses a `prompt()`.
  - The Credentials footer is Close only: every credential path for this kind is in the tab (deviation 3; no "Save Changes").
- **Claude (Subscription), claude-cli:** matches Mode A's card.
  - "CLI subscription session", the explanation, a `claude login` block with Copy, plus the install command with Copy, and "Check again".
  - Differences from the prototype:
    - No "CLI Session Active" badge: the tab has no per-session state beyond `claudeCliInstalled`.
    - No "Session valid · expires in 28 days": there is no expiry data.
    - No "Disconnect CLI Session": there is no RPC to revoke the Claude CLI login, and plan §2.3 says "no Delete-key control".
- **Light theme:** the outline buttons use the light theme's rounded style, the error-tone border on Delete key is visible, and the text is
  legible.

## Deviations and open points

1. **No key hint** (orchestrator decision). This is a fixed mask, flagged for the user at Gate V.
2. **No Overview latency** (orchestrator decision). No existing per-connection latency exists; the draft-probe latency appears only in
   Credentials.
3. **RUX entries added to the reachability table.** RUX-1/-4/-10 did not exist in the table (it listed only parity ids), so "flip to
   restored" meant adding them as `restored` entries. `EXPECTED_CAPABILITY_COUNT` goes from 81 to 84. The guard only forbids shrinking.
   `BASELINE_PRESENT_IDS` (64) is untouched.
4. **#49 is flipped for its drawer half only.** The entry's capability names the CLI-agent add/edit forms. Those get show/hide with the
   add-instance modal (plan :753), and that batch should extend the reach.
5. **Manage enabled for `anthropic`** (`providers-settings.component.ts:166`). The `connection.id !== 'anthropic'` exclusion existed
   because Manage used to open the wizard, which cannot store the Claude API key as connect-only. Manage now opens the drawer, which follows
   the plan :649-652 rule (RUX-4).
6. **A custom connection's Replace is sent as an `apiKey`-mode draft**, so `connectProvider` writes only `auth:setApiKey`.
   - The alternative, `authMode:'custom'`, would rewrite the whole custom entry (`provider:updateCustomEntry` with `defaultTiers` from the
     main-agent tiers).
   - The check still runs in `custom` mode against the stored endpoint.
   - If the endpoint has not loaded, Replace is not offered.
7. **"Edit in setup" is kept on Credentials for `local` and `custom`** (D14): their base URL (and the local optional key) is not in the
   tab yet.
8. **`providers-settings.component.spec.ts`** is outside the listed files. It was needed for the parent-level acceptance specs.
9. **Not built in this batch:**
   - Codex sign-out: the prototype has one, but there is no Codex logout RPC, and plan #13 asks only for copy and Open login.
   - Local base-URL editing (`updateLocalBaseUrl`) and custom endpoint fields: they belong to Batch 22 / Advanced, and setup covers them
     until then.

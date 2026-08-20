# Batch 3a Report — chat / chat-ui / webview shells (Lane 3a)

**Task**: TASK_2026_163 — premium-gate purge (open-source move).
**Executor**: frontend-developer (sub-agent).
**Status**: COMPLETE. All B3a.1–B3a.5 + 9 identified deltas applied. Production typecheck green across all 50 affected projects. Not committed (team-leader owns git).

---

## External-open mechanism for B4a (documented deliverable)

The `openPricing()` method the Builders card must reuse is:

```ts
this.rpcService.call('command:execute', { command: 'ptah.openPricing' });
```

- Kept in `libs/frontend/chat/src/lib/settings/settings.component.ts` `openPricing()` (comment updated to describe Builders reuse). Same mechanism is also used by the repointed `license-status-card.component.ts` (`openPricing()`, `openSignup()` → `ptah.openSignup`).
- It is a VS Code/Electron host command executed via the `command:execute` RPC — NOT a new RPC namespace. The destination URL is resolved host-side behind the `ptah.openPricing` command; B4a repoints that URL to the Builders/community page (coordinate final path with TASK_2026_162). B4a should call `command:execute` with `command: 'ptah.openPricing'`.

---

## Files touched

### B3a.1 — trial/upsell chat-ui components + exports

- DELETED `libs/frontend/chat-ui/src/lib/molecules/trial-ended-modal.component.ts`
- DELETED `libs/frontend/chat-ui/src/lib/molecules/trial-banner.component.ts`
- DELETED `libs/frontend/chat-ui/src/lib/molecules/community-upgrade-banner.component.ts`
- DELETED (delta) `libs/frontend/chat-ui/src/lib/molecules/notifications/notification-bell.component.ts`
- `libs/frontend/chat-ui/src/index.ts` — removed 3 trial exports + NotificationBell export
- `libs/frontend/chat/src/lib/components/index.ts` — removed trial re-export group + NotificationBell re-export (kept `CompactionNotificationComponent`); removed `templates/welcome.component` re-export
- `libs/frontend/chat-ui/CLAUDE.md` — removed trial + NotificationBell mentions
- `libs/frontend/chat/CLAUDE.md` — removed `welcome` template mentions (2 places)

### B3a.2 — app-shell + electron-shell

- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` — removed `TrialEndedModalComponent`, `WelcomeComponent`, `NotificationBellComponent` imports + `imports[]` entries; removed `'welcome'` from `STANDALONE_VIEWS`; deleted `licenseReason` + `isPremium` computeds
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` — deleted trial-ended-modal block; deleted `@case ('welcome')`; un-gated Marketplace nav (`@if (isPremium())` → unconditional); deleted notification-bell block; comment cleanup
- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` — deleted the full **Gate 1 license-lockout split-screen** (`@if (!appState.isLicensed())` hero) → workspace gate is now the primary `@if (!layout.hasWorkspaceFolders())`; navbar tabs gate `appState.isLicensed() && layout.hasWorkspaceFolders()` → `layout.hasWorkspaceFolders()`; un-gated Marketplace tab; deleted notification-bell block; deleted `isPremium` computed; removed `WelcomeComponent`/`NotificationBellComponent`/`ChatStore` imports; removed unused `computed` import; removed hero animation CSS block; docblock neutralized

### B3a.3 — welcome view + view plumbing

- DELETED `libs/frontend/chat/src/lib/components/templates/welcome.component.ts` + `.html`
- `libs/frontend/core/src/lib/services/app-state.service.ts` — removed `'welcome'` from `ViewType`; removed `isLicensed` from `AppState`; removed `'welcome'` from `validViews`; removed `_isLicensed` signal + `isLicensed` readonly; simplified `openViews` (dropped welcome filter); simplified `canSwitchViews` (dropped `onWelcomeView` block); removed `ptahConfig.isLicensed` read in `initializeState`; dropped `!== 'welcome'` guard; removed `isLicensed` from `getStateSnapshot`
- `libs/frontend/core/src/lib/services/claude-rpc.service.ts` — removed `UNLICENSED_ALLOWED_METHODS`, `isMethodAllowed`, the `LICENSE_REQUIRED` early-return block in `call()`, `RpcResult.isLicenseError()`/`isProRequired()` methods, and the now-unused `AppStateManager` import/inject
- `apps/ptah-extension-webview/src/app/app.ts` — removed `'welcome'` from `VALID_VIEWS`
- `apps/ptah-extension-vscode/src/services/webview-html-generator.ts` — removed `isLicensed` from `WebviewHtmlOptions`, the options union, all locals/params/threading, and `ptahConfig.isLicensed`; removed `'welcome'` from `VALID_VIEWS` (neutral copy — marketplace-scanned app, R5 honored)
- `apps/ptah-electron/src/preload.ts` — removed `isLicensed` from startup-config type + `ptahConfig`
- `apps/ptah-electron/src/activation/bootstrap.ts` — removed `startupIsLicensed`/`startupInitialView` from `BootstrapResult`, locals, and return
- `apps/ptah-electron/src/main.ts` — removed both passthrough args to `registerPostWindow`
- `apps/ptah-electron/src/activation/post-window.ts` — removed both from `PostWindowOptions` + destructure; removed `baseStartupConfig`; IPC `returnValue` now `{ initialView: null, workspaceRoot, workspaceName }`; neutralized startup-config log

### B3a.4 — settings + license-status-card

- `libs/frontend/chat/src/lib/settings/settings.component.ts` — removed `isPremium`/`showPremiumSections`/`isLoadingLicenseStatus`/`isAuthenticated` computeds, `ChatStore` import+inject, `Lock` icon, unused `computed` import; KEPT `openPricing()` (comment updated for Builders reuse); docblock neutralized
- `libs/frontend/chat/src/lib/settings/settings.component.html` — removed Pro/Free tier badge; un-gated Tab 2 (orchestration) — renders unconditionally; un-gated Tab 3 — renders enhanced-prompts/mcp/vscode-lm unconditionally; deleted both "Upgrade to Pro" upsell blocks; Tab 3 icon → always Sparkles; tab label "Pro Features" → "Advanced"; comment cleanup
- `libs/frontend/chat/src/lib/settings/license/license-status-card.component.ts` — REPOINTED to Ptah Builders membership card: kept status badge/valid state, user profile + Log Out, key-entry form, `enterLicenseKey`/`submitLicenseKey`/`removeLicenseKey`/`openSignup`/`openPricing`; DELETED trial-countdown section, trial-progress bar, trial-expired section, days-remaining section, all "Upgrade to Pro"/"Renew" CTAs, and the `showTrialInfo`/`trialEndDate`/`trialProgress`/`trialUrgencyLevel`/`trialStatusText`/`trialDaysRemaining`/`daysRemaining`/`trialActive`/`tierDisplayName`(unused) computeds; removed `TRIAL_DURATION_DAYS` import + `Clock`/`CreditCard` icons; "View Pricing" → "Explore Ptah Builders" (same `ptah.openPricing`)

### B3a.5 — chat-empty-state

- `libs/frontend/chat/src/lib/components/molecules/setup-plugins/chat-empty-state.component.ts` — removed `isPremium` computed, `ChatStore` import+inject, unused `computed` import; removed "Pro" badge; Tab-1 plugin-status-widget renders unconditionally (upsell block deleted); Tab-2 warning gate `isPremium() && !hasConfiguredSkills()` → `!hasConfiguredSkills()`; dropped `isPremium` guards in `setActiveTab`/`openPluginBrowser`

---

## Deltas beyond the enumerated task list (UNVERIFIED-SITE PROTOCOL)

1. **NotificationBellComponent deleted** — it is 100% a trial/upsell surface (trial countdown "N days left in your Pro trial" + "Your Pro Trial Has Ended / Upgrade to Pro for full access", both linking to `ptah.openPricing`). Only consumers were the two shells. Deleted the component + export + re-export + both shell usages/imports. `CompactionNotificationComponent`/`CompactionMarkerComponent` (unrelated) kept.
2. **`libs/frontend/core` is a full frontend enforcement layer** (task said only "view routing"). Purged `app-state.service.ts` `isLicensed` signal/field/snapshot + `welcome` ViewType, AND `claude-rpc.service.ts` `UNLICENSED_ALLOWED_METHODS` gate + `LICENSE_REQUIRED` producer + `isLicenseError`/`isProRequired` (no production callers — verified).
3. **electron-shell Gate 1** was a full license-lockout split-screen (auth-welcome hero) far larger than the "~:267 nav gate" cited; removed entirely, including its hero CSS animations.
4. **`welcome.component.ts` (`ptah-auth-welcome`)** was imported by BOTH app-shell (`@case`) and electron-shell (Gate 1); both un-wired.
5. **Electron `startupIsLicensed`/`startupInitialView` scaffolding** (Batch-1 leftover) removed across bootstrap/main/post-window/preload; both were dead welcome-lockout scaffolding (`isLicensed` always true, `initialView` always null). Lower-risk choice: preload keeps `initialView` field defaulting to `'chat'`; IPC returnValue hardcodes `initialView: null`.
6. **settings**: removed the Pro/Free tier badge and `isAuthenticated`/`showPremiumSections` (advanced sections now render for everyone, not just authenticated) per "settings shows all sections signed-out". Tab label "Pro Features" → "Advanced" (neutral; tab id `'pro-features'` kept to avoid touching `SettingsTabId` in core — lower risk).
7. **license-status-card** fully rewritten as a membership card (see file list).
8. **CLAUDE.md doc cleanup** in `chat-ui/CLAUDE.md` and `chat/CLAUDE.md` (removed deleted-component/welcome-template mentions).
9. **angular-webview.provider.ts**: plan cited `:109-167` but grep found NO `isLicensed`/`welcome` gating there — the provider never passed `isLicensed` to the generator. No change needed (recorded per protocol).

### Ambiguity calls (lower-risk, recorded)

- Kept the settings `'pro-features'` tab id (only relabeled the visible text) to avoid rippling into `SettingsTabId` in `libs/frontend/core` (`app-state.service.ts`) — out of the enumerated file set.
- Membership badge maps `trial_pro`/other tiers to "Community" (no trial framing); "Builder" badge shown only when `isPremium()` true.

## Verified KEEP (untouched, per instructions)

- `chat-lifecycle.service.ts` `licenseStatus` signal + `chat.store.ts` licenseStatus (feed the membership card).
- `electron-welcome.component.ts` (`ptah-electron-welcome`) — workspace "Open Folder" prompt, not license-gated.
- `LicenseGetStatusResponse.isPremium`/`trialActive`/tier wire fields (shared, kept). Membership card still reads `isPremium`/`isCommunity`/`valid`/`reason`/`plan`/`user` from this wire shape — allowed identity reads.
- Landing-page trial-ended components (Lane 4b), setup-wizard `WelcomeComponent`/`'welcome'` step (Lane 3b), Compaction\* components.
- `openPricing()` in settings.component.ts (B4a reuse).

---

## Acceptance results

### Grep 1 — `'welcome' | isLicensed` (apps/ptah-extension-webview, apps/ptah-extension-vscode, apps/ptah-electron, libs/frontend/core; non-spec)

```
grep -rn "'welcome'\|isLicensed" <trees> --include=*.ts | grep -v .spec.ts
→ (no matches, exit 1)  ✅ CLEAN
```

### Grep 2 — `LICENSE_REQUIRED | PRO_TIER_REQUIRED` in libs/frontend (non-spec)

```
grep -rn "LICENSE_REQUIRED\|PRO_TIER_REQUIRED" libs/frontend --include=*.ts | grep -v .spec.ts
→ (no matches, exit 1)  ✅ CLEAN
```

### Grep 3 — dangling deleted-component refs (chat/webview, non-spec)

No hits for `TrialEndedModalComponent`/`TrialBannerComponent`/`CommunityUpgradeBannerComponent`/`NotificationBellComponent`/chat `WelcomeComponent`/`ptah-auth-welcome`/`ptah-notification-bell`/etc. (Only `ElectronWelcomeComponent` and setup-wizard's own `WelcomeComponent` remain — both correct KEEPs.)

### Grep 4 — trial/upsell copy in chat (non-spec)

No hits for `Upgrade to Pro`/`days left in your`/`Pro Trial`/`trial_pro`/`Trial Expired`/`trialDaysRemaining`/`trialActive`. ✅ CLEAN

### Production typecheck

- `nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/chat-ui @ptah-extension/chat` → **Successfully ran for 3 projects** ✅
- `nx run-many -t typecheck -p ptah-extension-webview ptah-extension-vscode ptah-electron` → **Successfully ran for 3 projects** ✅
- `nx affected -t typecheck --exclude=tag:type:e2e` → **Successfully ran target typecheck for 50 projects** ✅ (confirms no downstream lib broke from the core `ViewType`/`isLicensed` removal)
- Only diagnostic emitted: a pre-existing `NG8102` warning in `confirmation-dialog.component.ts:33` (unrelated to this lane; a warning, not an error).

Spec files were NOT touched (Batch 5 owns them). Spec-referencing symbols like `app-state.service.spec.ts` still reference `isLicensed`/`'welcome'` and container-smoke specs — expected residue for Batch 5.

---

**Verdict**: Lane 3a COMPLETE — all trial/upgrade/lockout surfaces removed, membership card repointed, both frontend enforcement layers (core RPC gate + welcome view-plumbing) purged; both acceptance greps clean and production typecheck green for all 50 affected projects.

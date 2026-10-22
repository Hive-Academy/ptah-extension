# Design specification — Provider accounts

**Task:** `TASK_2026_712_5d7c`  
**Design phase:** Gate 1 approved; **Gate 1.7 revision 2** submitted for the final permitted cross-side review. This is a static interaction specification, not production implementation, runtime verification, release authorization, or authorization to enable subscription-authenticated sign-in.

## 1. Design basis and preserved scope

This is an Electron-first extension of the existing **Anubis / Anubis Light** Providers settings surface, not a replacement account-management product.

| Source | Applied rule |
| --- | --- |
| `apps/ptah-extension-webview/tailwind.config.js:80-147,149-194` | Reuse active `anubis` / `anubis-light` semantic tokens, Inter, JetBrains Mono, `rounded-box: 0.75rem`, `rounded-btn: 0.375rem`, and 150ms button motion. |
| `providers-settings.component.ts:88-96,184-208` | Retain the existing connection cards, catalog hint, provider setup wizard, and per-region retry pattern. Insert Accounts after Connections. |
| `NativeCardComponent`, `connection-detail-drawer.component.ts:49-110`, `NativeDrawerComponent` | Reuse compact clickable card anatomy and existing right-side drawer contract; embedded controls do not trigger the card. |
| `task-description.md:109-129` | Preserve add, status, mocked sign-in/sign-out, separate future main/lane selection, known/unknown owner treatment, model/effort semantics, and the Electron-only surface. |
| `parity-inventory.md:38-41` | No TUI or VS Code UI feature/polish. Existing provider settings and all other lanes remain available. |

**Visual language:** compact operational settings. At a glance the user can distinguish the named local profile selected for a future main session, the profile selected for a future Claude lane, and each profile's sign-in state. Quota-owner evidence is visibly distinct from profile label, directory, and status.

## 2. Placement, responsive layout, and hierarchy

Within **Settings → Providers**, render:

```text
Existing Main agent routing map — unchanged
Existing Connections — unchanged
Accounts
  Future routing summary
  Claude account profile list
Existing catalog hint / Browse catalog — unchanged
```

| Container / viewport | Exact behaviour |
| --- | --- |
| At least 960px settings content | Summary is two equal cells. List has the state column, wrapped assignment badges, and right action rail. |
| 640–959px | Summary cells stack. Profile metadata wraps before its Manage button. |
| Under 640px viewport **or** embedded container about 400px | One column; no horizontal scrolling; assignment badges wrap; profile grid becomes profile/state then action. Only **Add Claude account** remains primary on the section. |

The prototype implements a real `@media (min-width: 640px) and (max-width: 959px)` band (stacked summary; profile metadata/badges wrap before the Manage rail), a real `@media (max-width: 639px)` branch, and a container-query `.shell.embedded` branch. The latter represents a 400px Electron sidebar without pretending that a max-width alone triggers viewport media queries.

## 3. Accounts section

### 3.1 Header and action

```text
Accounts                                      [Add Claude account]
Use a named local profile for a future main session or Claude lane. Credentials stay local.
```

- **Add Claude account:** `btn-primary btn-sm`; label-only native modal contract, no credential form or directory chooser. [project token source above]
- Secondary/destructive controls are `btn-outline`, `btn-ghost`, or `btn-error btn-outline`; there is one primary action per surface. [project component rule]
- A duplicate canonical-directory attempt is rejected with: **“This local account directory is already represented by another profile. Rename that profile instead.”** It does not expose, display, or ask for a directory. The architect owns canonical comparison. [task-description.md:146]

### 3.2 Future routing summary and chooser

Each `surface-2` cell includes provider initials, selected profile name or **Use existing default**, status text, profile-ID suffix when named, scope sentence, and an outline **Change** button.

| Cell | Scope sentence | Change chooser behaviour |
| --- | --- | --- |
| Next main session | “Applies to a new session only.” | Opens the chooser scoped to main selection only. |
| Next Claude lane | “Applies when a Claude lane is spawned.” | Opens the same chooser scoped to lane selection only. |

The chooser has an explicit first option **Use existing default**. It is selectable even when signed-in profiles exist and clears only that target selection; it never selects the first account implicitly. Signed-in profiles appear first, followed by all other named local profiles labelled with their state. A named profile that is not signed in can be selected for a future run, but its status explains that it must sign in before use. When no named profiles exist, the only enabled choice is **Use existing default** and the chooser says “No named Claude accounts yet.” This preserves each runner path's existing resolution.

### 3.3 Profile cards and owner evidence

One compact `NativeCardComponent`-style card represents one local profile. A 4px left spine is used only for attention/error states.

- Card: initials, local label, monospace safe profile ID, labelled status dot/text, assignment badges, and **Manage** outline control.
- **Owner evidence:** show only `Verified identity` when that profile's owner field is `verified`; show **Unknown owner** when its owner field is `unknown`. A profile label, profile ID, sign-in state, or directory never proves owner identity. No email, organization, token, directory, or credential content is rendered.
- Show **Run binding** only for profiles whose `runs > 0`; current-run count comes from that record rather than a hard-coded value. The panel states that rename/default/sign-out does not move an already started run and an unavailable bound profile fails closed.

### 3.4 Drawer production contract versus prototype

**Production component contract:** opening a row or Manage must reuse `NativeDrawerComponent`: accessible name **“Account details for [label]”**, right-side 150ms backdrop / 180ms panel motion, `prefers-reduced-motion` suppression, existing focus trap, Escape/backdrop close request, and focus return to its opener. This is a required implementation contract, not proof that the static prototype contains Angular's native drawer.

The prototype implements a local dialog facsimile only: Escape/backdrop/Close, a simple Tab cycle excluding controls inside hidden panels, and return focus to the remembered opener. The Add modal also restores focus to its opener after either cancellation or confirmation. These source-level interactions do not claim production runtime verification or replace `NativeDrawerComponent`.

Drawer tabs:

- **Overview:** local profile ID; state; owner evidence driven by record; conditional Run binding.
- **Access:** state-specific copy and controls in §3.5.
- **Profile:** local-label rename, outline default action, and `btn-error btn-outline` removal confirmation. Rename text: “Changes the local label only. Existing runs keep the profile ID they started with.” Removal text does not claim file or credential deletion.

### 3.5 Mocked Access state machine

The UI calls only a mocked account-action seam. It does not log in/out, inspect credentials, launch a process/browser, call a provider, or run inference during design/prototype work.

| State | Visible status / Access heading | Required controls |
| --- | --- | --- |
| `not-signed-in` | Not signed in | **Sign in** |
| `pending` | Signing in | **Cancel sign-in** only, plus drawer close. |
| `cancelled` | Sign-in cancelled | **Sign in again** |
| `failed` | Sign-in failed | **Try again** |
| `disconnected` | Disconnected | **Sign in again** |
| `signed-in` | Signed in | **Sign out** (`btn-error btn-outline`) |
| `signed-out` | **Signed out** | **Sign in again** |

For static review, the prototype's clearly labelled **Mock next outcome** selector controls whether a later mocked sign-in resolves as signed in, disconnected, or failed. It is prototype-only tooling, not a production account control. A sign-in first visibly enters `pending`; only pending exposes Cancel. Cancel reaches `cancelled`; Sign out reaches the distinct `signed-out` state, never `not-signed-in`.

### 3.6 Add, default, removal, resume

- Add modal accepts a local label only. Confirm adds a fake `not-signed-in` profile; the duplicate-path control demonstrates the secret-free rejection in §3.1.
- **Set as default:** outline control and toast: “Default changed for future unbound starts. Existing runs are unchanged.” A new default never captures legacy or bound resume records.
- **Remove:** native confirmation contract: “This removes only local profile metadata. It does not switch, transfer, or delete a running conversation. A run bound to this profile cannot resume until its binding is available.” The prototype renders this copy in its Remove confirmation dialog; confirming is explicitly mocked and retains the fixture profile.
- A static unavailable-resume dialog says to choose neither another profile nor current default. Legacy unbound resume remains the historic ambient route, not a recovery chooser.

## 4. Claude lane capability preservation

Only the existing **Claude system-lane** spawn/configure control gains an **Account** field. It includes Use existing default and the same account choices, remains distinct from the generic provider card, and does not alter other system lanes.

- Omitted model uses **Configured default** and omitted effort uses **Configured precedence**. [task-description.md:148,170]
- Prototype-only controls demonstrate one supported model/effort pair as **Forwarded unchanged** and an unsupported effort as **Not applied — configured precedence remains in effect**. These labels do not freeze a supported-model list.
- `modelTier: Ptah CLI only` remains explicit. No account selection couples to model or effort.
- Messaging, permissions, MCP, and resume are labelled **capability not yet reported**, not inferred from a mocked surface.

## 5. Accessibility and contrast

**Criterion:** WCAG 2.1 AA / current WCAG AA because no stricter project requirement is stated. Normal text is at least 4.5:1; non-text focus/component boundaries at least 3:1. Text labels and icon/text combinations, not colour alone, communicate every state.

| Pair / treatment | Measured or source ratio | Evidence |
| --- | --- | --- |
| Dark `base-content #e8e6e1` on `base-100 #131317` | 14.2:1 | Tailwind token values above; WCAG relative-luminance arithmetic. |
| Dark muted token on `base-300` | 5.01:1 | `tailwind.config.js:106-109`. |
| Light base-content on `base-100` | 13.0:1 | `anubis-light` token values at `tailwind.config.js:179-188`; WCAG relative-luminance arithmetic. |
| Light muted token on `base-300` | 5.01:1 | `tailwind.config.js:184-188`. |
| Light focus outline `neutral oklch(27% .006 286.033)` on cream surfaces | 9.4:1 minimum against base-100 | `tailwind.config.js:174-183`; WCAG relative-luminance arithmetic. |
| Dark focus outline `base-content #e8e6e1` on `base-100` | 14.2:1 | same dark token values. |

Every interactive element, including the keyboard-operable `.profile[role="button"]` card, has a **2px solid `--focus-ring`** outline with a 2px offset. `--focus-ring` is dark `base-content` in Anubis and dark `neutral` in Anubis Light; it is never light-theme `base-content` by assumption. The toast uses `neutral` with light `base-100` foreground in Anubis Light (and `base-content` in Anubis), preserving the dark neutral surface with an explicitly light foreground. The static artifact has not been contrast-probed or rendered in Electron; the listed ratios are token arithmetic, not runtime evidence.

## 6. Revision 2 final correction table

| Review blocker / source | Revision 2 action | Source evidence / verification boundary |
| --- | --- | --- |
| A. Empty fixture named profiles in routing and chooser | The `empty` fixture now sets `accounts=[]`, `mainId=null`, and `laneId=null` together. Routing, lane field, and chooser all resolve from that same `accounts` list, so both routes show **Use existing default** and the chooser offers only that enabled choice plus “No named Claude accounts yet.” | `prototype/index.html` `setFixture()`, `render()`, `openChooser()`. Source implemented; interactions not executed. |
| B. Profile card lacked focus ring | Added `.profile:focus-visible` to the shared 2px `--focus-ring` rule; Anubis Light continues to use dark `neutral`. | §5; prototype focus selector. Source implemented; not rendered or contrast-probed. |
| B. 640–959px layout tier absent | Added the specified viewport band: summary cells stack; profile metadata/badges occupy columns before the Manage rail. Existing under-640px and embedded-400px branches remain. | §2; prototype `@media (min-width:640px) and (max-width:959px)`. Source implemented; not viewport-tested. |
| Light toast foreground matched dark toast background | Added the explicit `--toast-content` token, resolving to light `base-100` in Anubis Light. | §5; prototype theme token block. Source implemented; not contrast-probed. |
| Drawer Tab cycle included hidden panel fields | The local trap filters controls whose ancestor is `[hidden]`; production reuse of `NativeDrawerComponent` is unchanged. | §3.4; prototype drawer keydown handler. Source implemented; keyboard interaction not executed. |
| Add cancellation did not restore focus | Added the Add dialog `close` listener to restore focus to the remembered opener after cancellation or confirmation. | §3.4; prototype `#addDialog` close handler. Source implemented; interaction not executed. |
| Unsupported effort text differed from the contract | Prototype now says **Not applied — configured precedence remains in effect** exactly. | §4; prototype unsupported handler. Source implemented. |
| Remove confirmation was only a toast placeholder | The prototype now renders the exact §3.6 confirmation copy in a dialog; confirmation is clearly mocked and retains fixture data. | §3.6; prototype `#removeDialog`. Source implemented; interaction not executed. |

## Decisions

- **Decision:** Make fixture switching destructive to the local fixture state rather than merely changing the rendered view. **Options:** visual-only empty state; coherent empty records and null route selections. **Evidence:** Gate 1.7 revision 1 blocker A required routing and chooser to derive from the same empty list. **Reversible:** yes; static prototype only.
- **Decision:** Preserve the project-sourced dark `neutral` focus ring in Anubis Light and apply it to profile cards. **Options:** restore light `base-content`; apply existing `neutral`. **Evidence:** `design-review.md` blocker B and the cited Anubis Light token mapping. **Reversible:** yes; token reference remains authoritative.
- **Decision:** Keep remove confirmation mocked after displaying its full contract copy. **Options:** simulate destructive fixture mutation; retain the fixture after a labelled mock confirmation. **Evidence:** scope forbids production behavior and §3.6 is a confirmation-copy requirement. **Reversible:** yes.

Related source-only corrections in this revision: profile run counts remain record-driven; the prototype local focus behavior names rather than replaces the production native-drawer contract; duplicate rejection retains its fixed mocked message; citations point to acceptance criteria `task-description.md:109-129`; Add is `btn-sm`, destructive controls use `btn-error btn-outline`, and drawer accessible name includes “Account details for”.

## 7. Gate, release hold, and verification

1. Gate 1.7 remains **not passed** until the final permitted cross-side review returns APPROVED. This revision makes no user approval claim.
2. Subscription enablement/release is unresolved and user-reserved. Mocked transitions do not establish authorization.
3. Revision 2 source implementation is limited to `design-spec.md` and `prototype/index.html`: coherent Empty fixture state; profile focus selector; 640–959px layout band; toast foreground; hidden-panel trap exclusion; Add cancel focus return; exact unsupported-effort wording; and rendered mocked removal confirmation. No production code was changed.
4. No Electron app, local server, browser, screenshot, login, logout, credential source, provider call, or inference was used. Rendered Electron visual evidence (including layout, focus, contrast, and keyboard behavior) remains unverified pending explicit authorization.
5. JavaScript syntax was checked locally with `node --check` by extracting the inline script to a temporary file; no interaction, network, or package installation occurred. No heavy check is applicable to two static task artifacts.

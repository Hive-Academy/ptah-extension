# Design review — TASK_2026_712_5d7c

**Verdict: APPROVED**
**Round:** Gate 1.7 cross-side re-review, revision 2 of max 2
**Author:** in-process ui-ux-designer (`design-spec.md`, `prototype/index.html`)
**Reviewer:** Grok CLI lane, opposite execution side from the in-process author
**Artifacts reviewed:** revision 1 `design-review.md` (read before replace), revised `design-spec.md`, revised `prototype/index.html`.
**Scope of this pass:** blocker A, blocker B, and the five associated revision-1 notes (toast contrast, drawer focus filtering, Add focus restoration, unsupported-effort copy, remove confirmation). No new design preferences.
**Release status: HOLD.** Subscription enablement and release stay unresolved and user-reserved. This approval is a technical design-source approval only. It does not approve a release, a live subscription sign-in, a scope reduction, or any removal.

## Evidence convention

This is a document and prototype-source review. It is not rendered Electron verification and not a screenshot review. Line numbers are from the worktree files named above. Prototype behaviour is what the script and stylesheet do.

No production source was edited. No Electron process was started. No credential, `.env`, login, logout, or inference was touched. `ptah_*` tools were not available (tool search returned no Ptah server; a second search for report/spawn tools also returned none). Token identity for light `neutral` was not re-read; the prototype value is unchanged from the value revision 1 matched to `tailwind.config.js:175`.

Rendered dark, light, focus, contrast, and viewport evidence stays pending. That pending evidence does not by itself block this technical design approval.

## Blocker A — fixed in source

Revision 1: Empty set `view='empty'` only, so routing and the chooser still named Work Claude and Personal Claude.

Revision 2: `setFixture('empty')` sets `accounts=[]`, `mainId=null`, and `laneId=null` together (`prototype/index.html` `setFixture`). `render()` still calls `renderRouting()` before the empty-list branch, and that is now consistent:

- `choice(null)` renders **Use existing default** for both Next main session and Next Claude lane (`choice`, `renderRouting`).
- The lane badge uses `byId(laneId)?.label||'Use existing default'`, so Account shows **Use existing default** (`render`).
- The list body is **No named Claude accounts** (`render` empty branch).
- `openChooser()` builds options only from `accounts`. With length 0 the dialog has one account button, **Use existing default** (`data-choice=""`), plus the sentence **No named Claude accounts yet.** Choosing it calls `setChoice(null)` and writes only the scoped route (`setChoice`).

`setFixture('populated')` restores the seeded list and the two route ids. Adding a profile from the empty fixture appends one `not-signed-in` record and sets `view='populated'` without assigning `mainId` or `laneId`, so the new profile is not selected implicitly (`confirmAdd`).

## Blocker B — fixed in source

**Profile focus ring.** The shared rule is `button:focus-visible, input:focus-visible, select:focus-visible, .profile:focus-visible` with `outline: 2px solid var(--focus-ring)` and `outline-offset: 2px` (`prototype/index.html` stylesheet). Each card is `article.profile` with `role="button"` and `tabindex="0"` (`render`). Anubis Light still sets `--focus-ring: var(--neutral)` and `--neutral: oklch(27% .006 286.033)`. The light ring is not `base-content`.

**640–959px band.** `@media (min-width: 640px) and (max-width: 959px)` sets `.summary` to one column and `.profile` to `minmax(0,1fr) minmax(0,1fr) auto`, with `.profile .badges { grid-column: 1 / 3 }`. Summary cells stack. Badges occupy the columns before the auto Manage column and wrap onto the row that contains Manage. The default four-column row remains only outside this band. This matches §2’s existing middle-band sentence. It was not viewport-tested.

**Embedded 400px preserved.** `.shell.embedded { max-width: 400px }` is unchanged. `@container (max-width: 639px)` still sets the profile grid to `1fr auto` and places `.state` and `.badges` on `grid-column: 1 / -1`. That rule follows the 640–959px media query and has equal specificity, so a shell whose content box is at most 639px — including the embedded 400px shell while the viewport is inside 640–959px — keeps the embedded layout. The under-639px viewport branch is unchanged.

## Associated notes — fixed in source

1. **Toast contrast.** `.toast` is `background: var(--neutral); color: var(--toast-content)`. Dark `--toast-content` is `--content`. Anubis Light `--toast-content` is `--base-100` (cream) on the dark `neutral` surface. The previous dark-on-dark pairing is gone in source. Ratios were not measured.
2. **Drawer Tab filter.** The trap builds its list with `.filter(x => !x.disabled && !x.closest('[hidden]'))` (`#drawer` keydown). Access and Profile start as `hidden`, and tab clicks set `hidden` from the selected tab. Controls in a hidden panel are excluded; Close and the tab buttons are not inside those panels. Production remains `NativeDrawerComponent` (§3.4). Keyboard behaviour was not executed.
3. **Add focus restoration.** `#add` stores `opener`. `#addDialog` listens for `close` and calls `opener?.focus()`. Cancel is a `method="dialog"` submit. Confirm calls `$('#addDialog').close()` after a successful mocked add, which fires the same listener. A duplicate-path rejection returns without closing. Interaction was not executed.
4. **Unsupported effort copy.** `#unsupported` sets model to **Configured default** and effort to **Not applied — configured precedence remains in effect**, the §4 sentence. Supported values stay the forwarded-unchanged pair. `modelTier: Ptah CLI only` is still static markup.
5. **Remove confirmation.** `#removeDialog` renders the §3.6 sentence: “This removes only local profile metadata. It does not switch, transfer, or delete a running conversation. A run bound to this profile cannot resume until its binding is available.” Confirm closes the dialog and toasts that the static fixture retains the profile. It does not splice `accounts`.

## Holds that remain

These are not technical-design blockers for this source approval:

- Subscription enablement and release are unresolved and user-reserved (`design-spec.md` §7, `task-description.md` criteria that keep sign-in mocked). Mocked transitions do not authorize a live subscription sign-in.
- Rendered Electron evidence is still pending: no layout measurement, focus check, contrast probe, or screenshot. Later visual review still needs an explicit Electron launch permission and stays Electron-only.
- No removal is approved. Add, status, mocked sign-in, and mocked sign-out stay in the spec.

## What this review does not grant

- No approval to enable or release a subscription-authenticated Claude or Codex sign-in.
- No removal, and no replacement of add, status, sign-in, or sign-out.
- No architecture, storage layout, runner adaptation, or batch split.
- No live authentication, inference, commit, or push.

## Review execution

Only `design-review.md` was replaced. No design, prototype, or production file was edited. No agents were spawned. No user question was sent. No heavy check was run. `ptah_agent_report` was not available in this session (tool search returned no matching tool).

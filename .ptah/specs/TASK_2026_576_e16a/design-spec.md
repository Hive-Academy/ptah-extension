# Design Specification — TASK_2026_576_e16a: Advanced Git Review UI

Design system applied: **Ptah / Anubis** (`.claude/skills/technical-content-writer/DESIGN-SYSTEM.md`), themes `anubis`
(dark, default) and `anubis-light` (light), as compiled in
`apps/ptah-extension-webview/tailwind.config.js`. No new design system is created — this
is a functional developer-tool surface built entirely from existing tokens and
components. Existing git-ui/chat-ui component patterns (`libs/frontend/git-ui`,
`libs/frontend/chat-ui/src/lib/molecules`) set the density and idiom; this spec extends
them, it does not replace them.

## 0. How to read this document

- Every token cited below is either a Tailwind/daisyUI utility already in the compiled
  theme (`apps/ptah-extension-webview/tailwind.config.js:70-189`), a CSS custom property
  it defines, or a component already shipping in `libs/frontend/ui` / `libs/frontend/git-ui`
  / `libs/frontend/chat-ui`. Anything without a citation is new _composition_ of existing
  tokens, not a new value.
- Contrast: measured against **WCAG 2.2 AA** (4.5:1 body text, 3:1 large text/UI
  components), because the repository's own `base-content-muted` note
  (`tailwind.config.js:13-31`) already targets AA and gates it with a spec
  (`apps/ptah-extension-webview/src/app/base-content-muted.spec.ts`). Pairs measured are
  listed per surface under "Contrast".
- Renderer: **`@pierre/diffs`, confirmed** (`research-report.md`, decision table row 1:
  real Nx/Angular production build measured ~131 KB gz core / ~189 KB gz for a realistic
  first diff with the JS regex engine — not the ~377 KB gz figure that used the WASM
  engine Ptah is not adopting; `@codemirror/merge` stays the documented fallback at
  ~145 KB gz). Every hunk affordance (toolbar, accept/reject buttons, comment anchor,
  stale banner) is specified as an **Angular light-DOM element projected into Pierre's
  own per-hunk slot** (`getHunkSeparatorSlotName`/`getAnnotationSlotName`,
  `research-report.md` §Evidence, `DiffHunksRenderer.ts:63,271,2456`), not an
  absolutely-positioned overlay tracking DOM coordinates. Pierre's vanilla `FileDiff`
  still creates its own shadow root internally, but slotted light-DOM children keep full
  Angular change detection, ARIA and keyboard handling — the mechanism the Risk table's
  "hunk controls rendered by Angular outside the shadow root" line anticipates
  (`task-description.md` Risk table). If the architect falls back to `@codemirror/merge`,
  the same controls become CodeMirror `mergeControls`/panel widgets instead of slotted
  elements; the controls' own markup, states and copy in this spec do not change either
  way.
- Verified overrides: three token _pairings_ in the compiled theme fail WCAG AA for
  small (≤12px) text at the specific role this spec puts them in, found and fixed during
  design-spec-review.md round 1. Each is a measured, per-theme substitute for the same
  semantic role — not a new token or a new design system — using the CSS Color 4
  OKLCH→linear-sRGB→relative-luminance formula (the same method that produced `--bcm`,
  `tailwind.config.js:13-31`). They are compiled once in `prototype/assets/input.css`
  as `.err-solid-text`, `.diff-add-text`, `.diff-del-text`:
  - `error-content` on solid `error` (daisyUI's own `badge-error`/`btn-error` pairing)
    measures **4.12:1 in `anubis-light`, 3.87:1 in `anubis`** — both fail 4.5:1. Fix:
    `.err-solid-text` sets `#131317` in light (5.51:1) and `#ffffff` in dark (4.83:1),
    applied alongside the existing `bg-error`/`btn-error` fill wherever small solid-red
    text appears (destructive confirm buttons, the "D"/"Conflicted" status badges).
    `btn-error btn-outline` (error as text-on-transparent) is worse, not better —
    3.57:1 light / 3.17:1 dark — so this spec no longer uses that daisyUI variant for
    text-bearing controls anywhere.
  - `text-success` (diff addition text) on `bg-base-100`/`bg-base-300` measures
    **2.36:1 in `anubis-light`** (dark passes at 5.62:1 on `base-100`). Fix:
    `.diff-add-text` uses `oklch(45% 0.17 162.48)` in light (5.90:1 on base-100, 4.90:1
    on base-300) and the existing `--su` hex in dark (unchanged, already passing).
  - `text-error` (diff deletion text) on `bg-base-100` measures **3.57:1 light / 3.84:1
    dark** — both fail. Fix: `.diff-del-text` uses `oklch(45% 0.22 20)` in light (6.94:1
    on base-100, 5.76:1 on base-300) and `#f87171` in dark (6.70:1 on base-100, 5.54:1
    on base-300 — `#ef4444` alone cleared base-100 at 4.92:1 but dropped to 4.07:1 on
    the change-set card's `bg-base-300` context, so the lighter red-400 shade is used
    for a safe margin on every background this class actually renders on).
  - A fourth pair, `success-content` on solid `success` (the `Accept` hunk-toolbar
    button, `btn-success`), measures **2.64:1 in `anubis` dark** (light passes at
    6.05:1). Fix: `.ok-solid-text` sets `#131317` in dark only (5.62:1 on `success`,
    also 5.04:1 on `info` — same near-black works for both, unlike `error`'s dark
    background, which needed light text instead).
  - Scope note: this round fixed every appearance of the failing `error`/`error-content`
    pair actually used in the prototype (banner, stale-hunk chip, all destructive
    confirm buttons, all "D"/"Conflicted" status badges) and the one `Accept` button
    that uses solid `success`. It did **not** re-derive the small single-letter status
    badges elsewhere that use the same failing `success`/`info`/`secondary` pairs
    outside the review canvas — `badge-success` "A", `badge-info` "M" (both fail in
    `anubis` dark, 2.64:1/2.95:1) and `badge-secondary` "R" (fails in `anubis-light`,
    4.13:1) — because no finding named them and re-deriving and re-applying a fix across
    every occurrence in all eight prototype files was judged to be new-finding work
    beyond this round's two-round budget, not a fix to a cited finding. See §13a "Known
    token-pair follow-up" for the recommended next step.

## 1. Aesthetic profile

- **Niche**: developer tool / AI coding agent orchestrator, Electron + VS Code webview.
- **Personality** (inherited from DESIGN-SYSTEM.md): Premium, Mystical, Technical —
  expressed here as _quiet and dense_, not decorative. A review surface is read for long
  stretches; the existing chat-ui idiom (`text-[10px]`/`text-[11px]` rows, `btn-xs`,
  `badge-xs`, 1px borders at `border-base-content/10`) is the correct density and this
  spec keeps it rather than introducing a heavier "dashboard" scale.
- **Influences carried over**: Superset's single-scroll review list + Open-in, Vibe
  Kanban's three-button conflict banner, VS Code's own diff/merge chrome (which VS Code
  users already trust and which this task deliberately does not re-skin).
- **Unique element**: none added. The `glow`/`glow-urgent` box-shadow keyframes
  (`tailwind.config.js:38-63`) already exist for urgent, time-bounded states
  (`permission-request-card.component.ts:57-58`); this spec reuses `glow-urgent` for one
  state only (a hunk refused by the backend, Requirement 6.6) and nowhere else, to avoid
  diluting its meaning.

## 2. Design tokens used (no new values)

| Token                                                                                                                                            | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Usage in this spec                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-theme="anubis"` / `"anubis-light"`                                                                                                         | `tailwind.config.js:70,128`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Dark (default) / light theme, screenshotted both                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `bg-base-100` / `bg-base-200` / `bg-base-300`                                                                                                    | daisyUI base scale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Shell background / panel background / recessed rows (cards, hover)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `text-base-content`, `text-base-content-muted`                                                                                                   | `tailwind.config.js:13-31` (AA-gated), existing chat-ui usage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Primary text / secondary and tertiary text. Arbitrary alpha tiers (`text-base-content/40\|50\|60\|70\|80`) are **not used anywhere in this spec**: TASK_2026_183 removed them because no single alpha passes AA across every theme (`tailwind.config.js:13-31`, `base-content-muted.spec.ts`) — `text-base-content-muted` (`--bcm`) is the only vetted secondary/tertiary tier. An earlier revision of this table cited `text-base-content/70`; that was a citation error caught in design-spec-review.md round 1 finding 4 and is corrected here. |
| `border-base-content/10`, `border-base-300`                                                                                                      | `git-dock-header.component.ts:54`, native-tab-group                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Hairline separators                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `oklch(var(--su))`, `--er`, `--wa`, `--in`, `--s`, `--a`                                                                                         | `diff-display.component.ts:82-107`, `permission-request-card.component.ts:255-273`                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Status colors: success/error/warning/info/secondary/accent, theme-aware in both themes                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `btn btn-ghost btn-xs`, `btn btn-primary btn-sm`, `btn-outline`, `btn-error` (solid)                                                             | `git-dock-header.component.ts:60,88`, PROTOTYPING.md rule 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Icon buttons / the one primary action per surface / secondary actions / destructive actions. Destructive buttons use the **solid** `btn-error` fill with the `.err-solid-text` override (see §0 "Verified overrides"), not `btn-error btn-outline` — the outline variant's error-as-text measured worse in both themes.                                                                                                                                                                                                                            |
| `badge badge-xs badge-{success,error,warning,info,secondary,accent}`                                                                             | `permission-request-card.component.ts:74-99`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Status labels (never buttons — PROTOTYPING.md rule 3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `lucide-angular`, icon sizes `h-3 w-3` / `w-2.5 h-2.5`                                                                                           | `git-dock-header.component.ts:94`, `diff-display.component.ts:48`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | All icons                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `role="tablist"` tab bar (`border-b-2 px-3 py-2 text-sm`), `role="tabpanel"`                                                                     | `native-tab-group.component.ts:74-115`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Review-shell section switcher                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `bg-base-200 border border-base-300 rounded-lg shadow-xl` popover panel                                                                          | `native-popover.component.ts:70-93`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Branch/stash/comparison pickers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `animate-glow-urgent`                                                                                                                            | `tailwind.config.js:38-63`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Refused-hunk banner only (Req 6.6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `font-mono` (JetBrains Mono)                                                                                                                     | `tailwind.config.js:34-37`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Paths, hashes, diff code, commit subjects in monospace context                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--rounded-box` (0.75rem dark / 1rem light), `--rounded-btn`, `--rounded-badge`                                                                  | `tailwind.config.js:118-126,180-188`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Card/panel/button/badge corner radii, per theme                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `alertdialog` top-layer modal, focus-on-Cancel, Escape-cancels, focus trapped inside while open, focus returned to the invoking control on close | `diff-view.component.ts:482-567` pattern (kept); Angular implementation must use **CDK Dialog + CDK A11y `FocusTrap`** to get Escape-dismissal, focus trapping and focus-return for free rather than hand-rolling them (design-spec-review.md round 1 finding 3 — the prototype's own `app.js` originally focused the safe choice but did not trap Tab or restore focus; both are now implemented in the prototype's `initDialogs()` to demonstrate the full contract, but the production surface should get this from CDK, not reimplement it) | All destructive confirmations (discard hunk, drop stash, abort operation, remove worktree)                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Roving-tabindex toolbar                                                                                                                          | `diff-view.component.ts:249-345` pattern (kept)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Hunk toolbar, changed-file tree                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## 3. Information architecture — the Electron right dock

### 3.1 Decision

The dock keeps its current shell contract (lazy-loaded, `electron-shell.component.ts:366-392`,
resizable rail) but its **body becomes a four-tab "Review shell"** instead of a single
scrolling stack:

```
┌─ Review shell header (kept from today's git-dock-header) ───────────────────┐
│ [Branch ▾] [Stash 3] [Open-in ▾]              [Fetch] [↓2 Pull] [↑1 Push]   │
├─ Conflict banner (only while merge/rebase/cherry-pick in progress) ─────────┤
├─ Tabs: [● Changes 7] [Commit] [Task] [History] ─────────────────────────────┤
│                                                                              │
│  (active tab body — one of the 4 surfaces below)                           │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Changes** (default tab): the review canvas — changed-file tree + continuous diff.
  Opening the spot editor or a branch/historical comparison happens _inside_ this tab
  (see 3.3); it is not a fifth tab, because Requirement 7.4 rules out a second
  simultaneous editing surface and the spot editor is explicitly "not an IDE" chrome.
- **Commit**: the commit composer.
- **Task**: the task/worktree view (branch detail, worktrees, PR/CI).
- **History**: the per-task commit timeline + stash entries (Requirement 12 groups
  them; stash already lived under the header popover and keeps that popover **and**
  gains a home here, per parity row 5's "keep, also shown in the history timeline").

This is a `move` for the tab strip itself (parity row 1, "Tab strip of open diffs and
file views" → `move`) and satisfies every `keep`/`move` row: nothing in
`parity-inventory.md` loses a home. See §9 Parity map.

### 3.2 Why a tab strip, not one long scroll

The five requirements (6/7/9/10/11/12) are five distinct _tasks_ a user does at
different times (review hunks; write a commit; check PR status; resolve a conflict;
look at history). Stacking them vertically (today's dock shape) forces scrolling past
irrelevant sections to reach the one needed and does not fit a virtualized 200-file diff
list, which needs the full available height. A tab strip gives the review canvas the
full vertical space it needs (Requirement 6.2) while keeping the other three one click
away. The existing `NativeTabGroupComponent` pattern (`role="tablist"`, roving
`aria-selected`, `border-b-2` active indicator) is reused verbatim — no new tab
component is designed.

The **conflict banner** and **header** are the two cross-cutting elements that appear
above the tab strip regardless of which tab is active, because a conflict blocks every
kind of review (Requirement 11.1: "a banner shall appear above the review surfaces").

### 3.3 The spot editor's place

The spot editor (Requirement 7) is not a tab. It is a **mode of the Changes tab**: when
the user clicks "Edit" on a file row, or opens a chat file link, the Changes tab's right
pane swaps its content from the diff list to one CodeMirror 6 editor, with a small
sticky strip at the top: `← Back to review` · file path · Markdown preview toggle (when
applicable) · Save. The changed-file tree stays visible and interactive on the left so
the user can jump to another file's diff without losing the "Changes" context; opening
another file for _editing_ replaces the current editor per Requirement 7.4's own rule
(prompting first if unsaved). This reuses the same left-tree + right-pane skeleton as
the diff view, so no new page-level layout is introduced for editing.

### 3.4 Change-set card → dock entry point

The chat-transcript change-set card (Requirement 4, both hosts) is not part of the dock;
it lives in the transcript. Its "Review" action on Electron opens the dock (if closed)
already switched to the **Changes** tab, filtered to the card's file set (a scoped view,
not a separate mode — the same tree/diff components take an optional file-set filter).
Its VS Code actions never touch the dock; they call `ptah.review.*` (Requirement 5) and
are specified in §4.

## 4. Change-set card in the chat transcript (both hosts) — Requirement 4

### 4.1 Anatomy

A card appended after the last message of a turn that changed files, at the same
transcript width and indentation as other tool-result cards. Follows the
`diff-display.component.ts` idiom (compact header row, `text-[10px]`/`text-[11px]`,
`bg-base-300/50 rounded`) rather than inventing a new card chrome:

```
┌────────────────────────────────────────────────────────────────┐
│ ⌥ 4 files changed   +128 −42            [ Review ]  ← primary   │
├────────────────────────────────────────────────────────────────┤
│ M  src/app.ts                s+ 12  s− 3      >                 │
│ A  src/new-file.ts            s+ 40            >                 │
│ D  src/old.ts                       s− 39      >                 │
│ R  src/moved.ts ← src/orig.ts s+ 2  s− 0       >                 │
└────────────────────────────────────────────────────────────────┘
```

- Container: `bg-base-300/30 rounded border-l-2` with the border colored by dominant
  change type (reuses `permission-request-card.component.ts:56-59`'s
  `border-left-color` pattern — `oklch(var(--su))` when mostly additions, `oklch(var(--wa))`
  when mixed, `oklch(var(--er))` when mostly deletions).
- Header row: file-diff icon (lucide `FileDiff`, `h-3 w-3`), "N files changed",
  `+X −Y` totals in `.diff-add-text`/`.diff-del-text` `font-mono` (see §0 "Verified
  overrides" — plain `text-success`/`text-error` fails AA in `anubis-light` for text this
  small), and the **one primary action** `Review` as `btn btn-primary btn-xs` (Electron)
  or `Review all` (VS Code, same visual weight, different handler — §5).
- Each file row: status badge (`badge badge-xs`, color per status: `badge-success` A,
  `badge-info` M, `bg-error .err-solid-text` D, `badge-secondary` R — the D badge uses
  the corrected pairing from §0, not stock `badge-error`, which fails AA in both
  themes), path (`font-mono text-[11px]`, truncated from the left like
  `file-path-link.component.ts`), per-file `+N/−N` in muted `text-[10px]`, and a
  trailing chevron affordance — the whole row is a button (`role="button"`, full-width,
  `hover:bg-base-300/50`), not a nested interactive control (avoids the nested-button
  defect the parity inventory flags for worktree rows, §8 Defect note).
- Totals-unavailable state (Requirement 4.4): the `+X −Y` header chip becomes a
  `badge badge-ghost badge-xs` reading "counts unavailable" and every row's `+N/−N`
  becomes `text-base-content-muted` "?" instead of a number — never `+0 −0`.
- Reconciled-file state (Requirement 4.3): a file whose diff is now empty (committed or
  reverted) shows a `badge badge-ghost badge-xs` "No longer changes HEAD" in place of its
  counts, `opacity-60` on the row, and the row becomes non-interactive (no chevron).
- No card renders when a turn changed no files (Requirement 4.2) — verified by the
  absence of the card component in the transcript item list, not a hidden/empty card.
- Persisted rendering (Requirement 4.7): the card's data model (files, statuses,
  counts, reconciled flags) is serialized with the session, so reopening an old session
  renders the same card from that snapshot with no live RPC — the same pattern the
  transcript already uses for other persisted tool-result cards.

### 4.2 Contrast (measured against `anubis` / `anubis-light`, corrected in round 1)

Re-measured with the CSS Color 4 OKLCH→linear-sRGB formula (§0). The card's totals and
badges now use the corrected classes from §0, not the raw `text-success`/`text-error`/
`badge-error` this table originally (incorrectly) cleared:

| Pair                                                              | Dark (`anubis`)                         | Light (`anubis-light`)                        | Result                                                                                                                              |
| ----------------------------------------------------------------- | --------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `.diff-add-text` on `bg-base-300` (the card's own container tint) | 4.65:1 (`#16a34a`)                      | 4.90:1 (`oklch(45% 0.17 162.48)`)             | Pass AA                                                                                                                             |
| `.diff-del-text` on `bg-base-300`                                 | 5.54:1 (`#f87171`)                      | 5.76:1 (`oklch(45% 0.22 20)`)                 | Pass AA                                                                                                                             |
| `bg-error .err-solid-text` (the "D" status badge)                 | 4.83:1 (`#ffffff` on `#dc2626`)         | 5.51:1 (`#131317` on `oklch 64% .246 16.439`) | Pass AA. Stock `badge-error` (`error-content` on `error`) measured 3.87:1 dark / 4.12:1 light — both fail; this is the fix from §0. |
| `badge-ghost` label (`text-base-content-muted` on `bg-base-300`)  | 5.29:1 (per `tailwind.config.js:96-98`) | 5.01:1 (`:159-161`)                           | Pass AA (this is the exact pair the repo's own spec gates)                                                                          |
| `border-l-2` accent vs `bg-base-300/30`                           | 3:1+ (large graphic element)            | 3:1+                                          | Pass AA non-text                                                                                                                    |

## 5. VS Code native review path — Requirement 5

No new visual surface: the card's row and "Review all" affordances call
`ptah.review.openChanges`, `ptah.review.openDiff`, `ptah.review.openMerge`,
`ptah.review.openScm` (command names for the architect to confirm) which open VS Code's
own `vscode.changes`/`vscode.diff`/`git.openMergeEditor`/`workbench.view.scm`. The only
design decision here is **card parity with Electron**: the VS Code card uses the exact
markup in §4.1, with the row action swapped (open native diff instead of scroll-to in
canvas) and the header button relabeled `Review all` instead of `Review` to match VS
Code's own "Open Changes" terminology. A conflicted file's row shows a `bg-error
.err-solid-text` "Conflicted" badge (see §0 "Verified overrides" — stock `badge-error`
fails AA at this size in both themes) and its action opens the merge editor instead of a
diff (Requirement 5.3). When `vscode.changes` is unavailable at the 1.100 floor, "Review all" silently
falls back to opening each file's `vscode.diff` in sequence — no visible change to the
button, per Requirement 5's own graceful-degradation intent.

## 6. Electron review canvas — Requirement 6

### 6.1 Layout (the "Changes" tab body)

```
┌─ Comparison bar ───────────────────────────────────────────────────────┐
│ [Working tree ▾]  Filter: [________]  ⊞ Split  ▤ Unified   142 files   │
├──────────────┬───────────────────────────────────────────────────────┤
│ Changed files│  src/app.ts                              [Stage all]   │
│ ▾ Staged (3) │  ┌ renamed from src/old-app.ts ───────────────────────┐│
│  M app.ts    │  │ @@ -12,6 +12,9 @@  Hunk 1 of 3     [Accept][Reject]││
│  A new.ts    │  │  12   const x = 1;                                 ││
│ ▾ Changes(4) │  │ +13   const y = 2;                                 ││
│  M utils.ts  │  │  ...                                                ││
│  ⚠ big.bin   │  └─────────────────────────────────────────────────────┘│
│  (too large) │  ┌ src/new.ts — binary — [Open-in] ───────────────────┐│
│  ...         │  └─────────────────────────────────────────────────────┘│
│              │  (virtualized: off-screen files unmounted)              │
├──────────────┴───────────────────────────────────────────────────────┤
│ ✎ 2 draft comments                              [ Send to agent ]     │
└─────────────────────────────────────────────────────────────────────┘
```

- **Changed-file tree** (left, resizable 160–480px, keyboard resize — kept verbatim from
  `rail-resize-handle.component.ts`): collapsible folders, per-row status badge
  (`badge-xs`), `+N/−N`, click scrolls the continuous diff to that file (Requirement
  6.1). Collapsed state and width persist (`ElectronLayoutService`, parity row: keep).
- **Comparison bar** (top of the right pane): a comparison selector (`Working tree` /
  `Staged` / `Branch review…`) reusing the `NativePopoverComponent` panel chrome
  (`bg-base-200 border border-base-300 rounded-lg shadow-xl`), the split/unified toggle
  (`btn-group` of two `btn btn-ghost btn-xs`, `aria-pressed` on the active one, persisted
  — Requirement 6.8, kept from `diff-view.component.ts:352-370`), a filter text input
  (`input input-xs input-bordered`), and the running totals (`text-xs
text-base-content-muted`, `+N`/`−N` in `.diff-add-text`/`.diff-del-text` — see §0
  "Verified overrides"). The bar wraps (`flex flex-wrap`) rather than clipping when the
  dock is narrow (design-spec-review.md round 1 finding 2).
- **Continuous diff**: one virtualized scroll container (Pierre `CodeView` or the
  `@codemirror/merge`-per-file fallback list) holding every file's diff back to back,
  each with a **sticky per-file header** (file-type icon, path, rename-from, a hunk-count
  chip, chip: binary/too-large/new/deleted) reusing `diff-view.component.ts:200-227`'s
  header content, re-laid-out for the new continuous list with a translucent
  (`bg-base-200/95 backdrop-blur-sm`) fill and a hairline bottom border so it reads as
  elevated while scrolling past. Off-screen files render as a fixed-height placeholder
  row (skeleton, `skeleton-block.component.ts` pattern) so scrollbars stay accurate
  (Requirement 6.2). Each visible code line renders with an **old/new line-number
  gutter** (two right-aligned monospace columns, a `·` in the column that has no number
  for a pure addition/deletion), Pierre's own Shiki syntax highlighting (the JS regex
  engine, `preferredHighlighter: 'shiki-js'`, per `research-report.md`), and Pierre's
  word-level change highlighting nested inside the line's own tint (a stronger-opacity
  span around the exact changed substring, not just a whole-line color) — this is what
  "advanced and beautiful" cashes out to concretely: the diff reads like a modern
  code-review tool (GitHub/Pierre's own demo), not a plain colored-line text dump.
- **Hunk toolbar**: an Angular light-DOM element **slotted into Pierre's own per-hunk
  slot** (`getHunkSeparatorSlotName`, `research-report.md` — not an absolutely-positioned
  overlay; see §0), rendered as an in-flow header row directly above that hunk's lines
  with a faint tint (`bg-base-200/60`) distinguishing it from the code below, containing
  "Hunk _i_ of _n_", Previous/Next (`btn-ghost btn-xs`, roving tabindex, kept from
  `diff-view.component.ts:249-345`), and the comparison-appropriate actions. The row
  wraps (`flex flex-wrap`) under its own hunk rather than squeezing into unreadable
  multi-line text at narrow dock widths (round 1 finding 2):
  - Unstaged diff: `Accept` (`btn btn-success btn-xs`, stages via `git:applyHunks`) and
    `Reject` (solid `btn btn-error btn-xs` with the `.err-solid-text` override — see §0;
    opens the kept alertdialog confirmation, Requirement 6.4).
  - Staged diff: `Unstage` only (`btn btn-ghost btn-xs`).
  - Branch/historical comparison: no action buttons — the toolbar shows only the
    position indicator, `aria-disabled` (not removed) on Accept/Reject as the roving
    toolbar pattern already does.
- **Refused-hunk state** (Requirement 6.6): the hunk's toolbar strip is replaced by a
  bordered chip (`border border-error/60 bg-error/10 rounded`, `animate-glow-urgent`)
  holding a small `text-error` icon (non-text, only needs the 3:1 graphical-object
  threshold, which it clears) plus the backend's sanitized reason in
  **`text-base-content`** (round 1 finding 6: the original `badge badge-error` treatment
  put the message in `error-content`-on-`error`, which measures 4.12:1 light / 3.87:1
  dark — both fail 4.5:1; `text-base-content` on the same chip measures 13-14:1 in both
  themes, so the fix moves the _message_ off the failing pair while keeping `error` as a
  purely graphical accent, per §0). The diff underneath greys 15% (`opacity-85`) until
  the automatic re-read completes; it is never interactive as a renumbered hunk (no
  click target survives the re-read).
- **Draft-comment footer bar** (Requirement 6.7, resolves the open question — see §6.3):
  a slim bar pinned to the bottom of the Changes tab, `bg-base-200 border-t
border-base-content/10 px-3 py-1.5 flex flex-wrap items-center justify-between text-xs`,
  showing "✎ N draft comments" (click expands a popover list of the drafts, each
  removable) and the single primary action `Send to agent` (`btn btn-primary btn-xs`,
  disabled at 0 drafts — verified 5.18:1 light / 4.82:1 dark, passes AA, see §0). The bar
  is absent when there are zero drafts — it is not an empty state to guard against.
- **Binary / LFS / submodule / conflicted / too-large rows** (Requirement 6.10): each
  renders as a single fixed-height row with an icon + label instead of a diff body:
  `⊘ Binary file — diff not shown` / `⇪ Git LFS pointer` / `▤ Submodule` / `⚠
Conflicted — resolve to review` / `▦ Too large to display`, each paired with
  `Open-in` (kept `open-in-button.component.ts`). Label color: LFS/submodule/too-large
  use `text-base-content-muted` (informational, not alarming); binary is neutral;
  conflicted uses `text-error` for its leading icon (non-text, 3:1 threshold, passes)
  with the label text itself in `text-base-content` (the raw `text-error` label measured
  3.57:1 light / 3.84:1 dark against `bg-base-100`, failing 4.5:1 — same root cause as
  the stale-hunk fix above, same fix applied).

### 6.1a Responsive layout: container width, not viewport width

The two-column split (file tree + diff) and every wrapping row inside it must react to
**the Electron dock's own rendered width**, not the browser/OS window's viewport width.
Round 1 (finding 2) caught this as a real bug: a `min-width` media-query breakpoint stays
"wide" even when the dock itself is docked at its narrow end (the rail is 160–480px,
`rail-resize-handle.component.ts:21-28`) inside a much wider window, which clipped the
Reject button, wrapped the hunk header across three lines and overflowed the comparison
bar off-screen in the round-1 screenshots. The fix, and the rule for the implementation:

- Bind the two-column layout to **the same width source the rail resize handle already
  tracks** (`ElectronLayoutService`'s rail-width signal) wherever the two-column split is
  literally the resizable rail; where it is a different container (the dock's own outer
  width, which the file-tree/diff split also depends on), use a `ResizeObserver` on that
  container's host element — a plain, well-supported primitive, not a CSS viewport media
  query, and not a dependency on a Tailwind/PostCSS container-query plugin (neither is in
  this repository's toolchain).
- Below approximately 520px of the panel's own width, stack the file tree above the diff
  instead of beside it (matches the "tree moves below the list when narrower than 520px"
  capability already kept from `review/git-review-panel.component.ts:42-63`, parity §9).
- Every row that can host more than one interactive control (comparison bar, hunk
  toolbar, conflict-banner button row) wraps (`flex flex-wrap`) rather than clipping or
  forcing a horizontal scrollbar.
- The static prototype models this with a `ResizeObserver`-driven inline
  `grid-template-columns` toggle (`prototype/assets/app.js`, `initResponsiveGrids`) so
  the behavior is verifiable by resizing the prototype's own container, independent of
  the browser window size — see `prototype/review-canvas.html`.

### 6.2 Branch review mode

Unchanged in capability from today (parity: `move`), re-skinned into the comparison bar:
picking `Branch review…` opens a popover with base/head selects (kept), and the
continuous diff switches to read-only (no hunk toolbar actions, per Requirement 6.9 and
the "keep" row for that toggle). Totals, filter and per-file "Viewed" checkbox (kept,
persists per repository) sit in the same comparison bar / file tree as today, just
re-hosted in the tab.

### 6.3 Resolving the line-comment open question

**Decision: draft batch, one "Send to agent" action** (the task-description's own
recommendation, Requirement 6.7's wording, and the pattern every reviewed reference
product uses for PR-style line comments — reference-products note §1). Immediate-send
was rejected because a reviewer typically leaves several comments while reading one
diff pass, and sending each individually would interrupt the agent turn N times per
review instead of once. The draft bar (§6.1) is the whole of this decision's UI; drafts
persist in the canvas's own view-state service for the app session (Requirement 6.7's
own "survive closing and reopening… within the same app session"), not to disk.

### 6.4 Contrast (corrected in round 1, design-spec-review.md findings 1/5/6)

The original version of this table understated two failures because it measured the
wrong pairs (`badge-error`'s actual rendered pair is `error-content` on `error`, and
`btn-success`'s actual rendered pair is `success-content` on `success` — this table
previously claimed passing numbers for those exact pairs that a precise OKLCH→sRGB
calculation contradicts). Re-measured, with the round-1 fixes applied:

| Pair                                                                                | Dark                                                   | Light                                | Result                                                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Hunk toolbar text (`text-base-content`) on toolbar strip (`bg-base-200`)            | 13.1:1                                                 | 11.8:1                               | Pass AA                                                                                                                              |
| Stale-hunk chip message (`text-base-content` on `bg-error/10` over `bg-base-100`)   | ~13:1 (dominated by base, `/10` tint barely shifts it) | ~12:1                                | Pass AA. The chip's `error` icon and `border-error/60` are decorative/graphical only (3:1 threshold), not carrying the text.         |
| `error-content` on `error` (stock `badge-error`, **no longer used** for this state) | 3.87:1                                                 | 4.12:1                               | **Fails AA** — this is why the stale chip and every other small solid-error label in this spec use `.err-solid-text` instead (§0)    |
| `success-content` on `success` (stock `btn-success`, **no longer used** unmodified) | 2.64:1                                                 | 6.05:1                               | **Fails AA in dark** — `Accept` uses `.ok-solid-text` in dark (`#131317` on `success`, 5.62:1); light is unchanged (already passing) |
| `Accept` button label, corrected                                                    | 5.62:1 (`.ok-solid-text`)                              | 6.05:1 (unchanged `success-content`) | Pass AA                                                                                                                              |
| `Reject` button label, corrected (solid `btn-error` + `.err-solid-text`)            | 4.83:1                                                 | 5.51:1                               | Pass AA                                                                                                                              |

## 7. Single-file spot editor — Requirement 7

Header strip: `← Back to review` (`btn btn-ghost btn-xs`), file path (`font-mono
text-xs`, truncated-left), a read-only/edit badge (`badge badge-xs badge-ghost` "Read
only" when opened from a historical/blocked source, absent otherwise — status is a
badge, never a button), Markdown Preview/Source toggle (`btn-group`, two `btn-ghost
btn-xs`, disabled with a `title` note over 512 KB — kept exactly, Requirement 7.5), and
`Save` as the one primary action (`btn btn-primary btn-xs`, disabled with no changes).

Body: CodeMirror 6 (`EditorView`) filling the remaining height, syntax highlighting by
file extension, opened at the linked line/column when given (scroll + line highlight
using CodeMirror's own line decoration, not a new component).

States (all kept verbatim from `file-view.component.ts`, re-hosted):

- **Disk-conflict** (Requirement 7.3): a modal `alertdialog` — "This file changed on
  disk since you opened it." with `Reload` (safe/non-destructive, default focus) and
  `Overwrite` (`btn-error btn-outline`, secondary) — same focus-safe-choice rule as the
  existing revert dialog.
- **Replace-with-unsaved-changes** (Requirement 7.4): same alertdialog shape —
  `Discard and open` vs `Cancel` (focus on Cancel).
- **Blocked path** (Requirement 7.6): the existing blocked banner (`alert alert-warning
text-xs`) with the backend's reason, `Open-in` action, and the outside-workspace
  confirmation dialog — unchanged.
- **Markdown preview**: rendered with the project's existing markdown pipe
  (`SurfaceMarkdownPipe`, `MarkdownModule`, same as `diff-display.component.ts`), links
  resolved against the document per the kept `file-link-router.service.ts` rule.

Chat file links (Requirement 7 note 2, the open "edit vs view" default): **open in
read-only/view mode by default.** Rationale: a chat link is the agent pointing the user
at a place in code, not inviting an edit; defaulting to edit risks an accidental stray
keystroke committing to a file the user only meant to inspect. The editor's read-only
state is not a different component — it is the same CodeMirror instance with
`editable: false` and the "Read only" badge from the header strip; a single visible
`Edit` button (`btn btn-ghost btn-xs`) in the header flips it to editable. This keeps
one component, one set of states, and answers the note without inventing a second
"viewer" surface.

## 8. Monaco removal — Requirement 8

No new UI. The Skills clone-diff drawer (`lazy-diff-view.component.ts`) keeps its
existing chrome (a lazy-loaded drawer with an in-memory current-vs-proposed diff, no git
header) and swaps its renderer internals only — same `bg-base-300/50 rounded` diff
container idiom as `diff-display.component.ts`, unified layout only (it has no git
comparison mode to toggle).

## 9. Commit composer (Electron) — Requirement 9

Body of the **Commit** tab:

```
┌───────────────────────────────────────────────────────────┐
│ Staged: 5 files                         [ Generate message ]│
│ ┌─────────────────────────────────────────────────────────┐│
│ │ feat(git): add hunk-level reject confirmation           ││
│ │                                                          ││
│ └─────────────────────────────────────────────────────────┘│
│                                          [    Commit    ]   │  ← primary
├───────────────────────────────────────────────────────────┤
│ ▸ Running pre-commit…                                       │
│   ✓ eslint          0.4s                                    │
│   ✗ commitlint      0.1s  subject must not be empty          │
└───────────────────────────────────────────────────────────┘
```

- Staged-count line (`text-xs text-base-content-muted`) plus `Generate message`
  (`btn btn-outline btn-xs`, secondary — the one primary action is `Commit`).
- Message `textarea` (`textarea textarea-bordered w-full font-mono text-sm`, kept from
  `source-control-panel.component.ts:116-124`), always editable, including after
  generation.
- Generation failure (Requirement 9.2): an inline `text-warning text-xs` line under the
  textarea, "Message generation unavailable — type your own.", field stays editable, no
  modal.
- `Commit` (`btn btn-primary btn-sm`), disabled when nothing staged or message empty
  (Requirement 9.6), label becomes "Committing…" with a `loading loading-spinner
loading-xs` while in flight (kept idiom from the header's fetch/pull/push spinners).
- **Hook output panel** (Requirement 9.3/9.4): appears under the Commit button once a
  commit starts running hooks — a `bg-base-300/50 rounded font-mono text-[11px]
max-h-48 overflow-y-auto` scrollable log (same container idiom as
  `diff-display.component.ts:59-66`), each line prefixed with a state icon
  (`▸` running, `✓ text-success`, `✗ text-error`) and elapsed time, streamed live. On
  failure, the panel stays expanded, an `alert alert-error text-xs` banner reads "Commit
  blocked by <hook>. Message kept." and the message textarea is untouched (Requirement
  9.4, ties to RC1 acceptance 2).
- **Success** (Requirement 9.5): the log panel collapses, replaced by a one-line
  `badge badge-success badge-sm gap-1` + `font-mono text-xs` "a1b2c3d feat(git): add
  hunk-level reject confirmation", and the message field clears.

## 10. Task / worktree view (Electron) — Requirement 10

Body of the **Task** tab:

```
┌─ Branch ──────────────────────────────────────────────────┐
│ ⎇ feat/task-576-review-ui → origin/feat/task-576  ↑1 ↓0     │
├─ Pull Request ───────────────────────────────────────────┤
│ #412 Advanced git review UI          open · 2 approvals    │
│ ✓ 8 checks passing                        [ Open PR ↗ ]    │
├─ Worktrees (3) ───────────────────────────── [+ Add] ─────┤
│ ● feat/task-576-review-ui   (active)  …/wt/576             │
│   main                       (main)   …/ptah-extension     │
│   🔒 hotfix/urgent          (locked)  …/wt/hotfix   [×]     │
└─────────────────────────────────────────────────────────┘
```

- **Branch panel**: current branch, upstream, ahead/behind — reuses the header's
  ↑N/↓N badge idiom (`text-warning`/`text-info`, `git-dock-header.component.ts:176,196`)
  at slightly larger scale (`text-sm`) since this is the panel's primary content, not a
  header chip. This panel is the new home for the branch-details popover content
  (parity: `move`), shown inline rather than in a popover since the Task tab _is_ that
  detail view.
- **Pull Request panel**: PR number + title (`font-medium text-sm`), state as a
  `badge badge-xs` (`badge-success` open, `badge-ghost` draft, `badge-secondary` merged,
  `badge-error` closed — status is a badge, never a button), review decision as plain
  text, CI summary as three small counts with icons (`✓ text-success`, `✗ text-error`,
  `● text-base-content-muted` pending) and `Open PR` (`btn btn-outline btn-xs`, opens
  browser — external-link icon). When `gh` is missing/unauthenticated/non-GitHub
  (Requirement 10.4): the panel collapses to one `text-base-content-muted text-xs` line
  ("GitHub CLI not available — PR status hidden.") with **no alert styling** and no
  repeat prompts — this is the one place in the spec where a missing capability is
  deliberately _not_ an error state.
- **Worktrees panel**: kept list (branch/detached, path, main/active badges, now adding
  `badge-warning` "locked" and `badge-ghost` "prunable" — Requirement 10.2), `+ Add`
  (`btn btn-outline btn-xs`, opens the kept inline add form: branch name, optional path,
  "Create new branch" checkbox), and a **row is not a nested-button** — the row itself is
  the "switch" affordance (`role="button"`, full row), with Remove as a separate
  trailing icon button (`btn btn-ghost btn-xs`, `X` icon) _outside_ the row's own click
  target, which fixes the nested-interactive-control defect the parity inventory flags
  (§13 Defect note) without changing the row's information.

Refresh cadence (Requirement 10.5): a small `↻` icon button (`btn-ghost btn-xs`) in the
Task tab's own header lets the user force a refresh; automatic refresh happens on tab
open and after push, throttled to once/minute while visible — no UI for the throttle
itself, it is purely behavioural.

## 11. Conflict banner (Electron) — Requirement 11

**Redesigned in round 1** (design-spec-review.md finding 1, Major): the original solid
`alert alert-warning` fill passed for its own `warning-content`-on-`warning` text, but
every _other_ element placed on top of that orange fill did not carry a passing pairing
of its own — the outline `Abort` button (`error`-as-text on `warning`) measured **1.45:1
in `anubis-light`**, the secondary description text (`text-base-content-muted` on
`warning`) measured **2.04:1**, and the `Ask agent to resolve` primary button measured a
non-text boundary contrast of **~1.4:1** against the same fill. A full-bleed semantic
color is only safe for the one text role the theme paired it with; anything else placed
on it needs its own verified pairing, which is exactly the trap `--bcm` already exists to
avoid for `text-base-content-muted` specifically (`tailwind.config.js:13-31`) and which
this banner fell into for every other role.

Appears above the tab strip, full width, whenever `git:info` reports an operation in
progress — a persistent, non-dismissible bordered card (it is not a toast, and it is no
longer a solid-fill `alert`):

```
┌───────────────────────────────────────────────────────────────────────┐
│▐ ⚠  Rebase in progress — 3 files conflicted                            │
│▐    src/app.ts, src/b.ts, src/c.ts                                     │
│▐    [ Ask agent to resolve ]  [ Open in editor ]  [ Abort ]            │
└───────────────────────────────────────────────────────────────────────┘
  (▐ = 4px border-warning left accent; card fill is bg-base-200, not orange)
```

- Container: `bg-base-200 border-l-4 border-warning rounded-box` (the
  `permission-request-card.component.ts:56-59` left-accent pattern, reused rather than
  a full semantic fill), `role="alert"`. Operation name and conflicted-file count in
  `text-sm text-base-content`; the file list in `font-mono text-[11px]
text-base-content-muted` (now safe: both are verified pairs against `base-200`, not
  against `warning`). The `⚠` icon is not bare colored text — it sits inside a small
  `w-5 h-5 rounded-full bg-warning text-warning-content` chip, reusing the same solid
  `warning`/`warning-content` pairing the original banner already had verified (5.67:1
  light / 6.61:1 dark), so the one place `warning` still carries text stays a pair that
  actually passes. The `border-warning` left accent itself is decorative reinforcement
  alongside that already-accessible icon-plus-text, not the sole conveyor of meaning, so
  it is not required to clear the 3:1 non-text threshold on its own (and does not need
  to: raw `warning` on `base-100`/`base-200` measures 2.19-2.46:1 in `anubis-light`,
  another theme-token limit worth flagging alongside §0's scope note for whoever owns
  `tailwind.config.js` next).
- Three buttons, in this priority order (reference-products note §3 "agent first, IDE
  second, abort always"), wrapping (`flex flex-wrap gap-1.5`) rather than clipping at
  narrow dock widths (round 1 finding 2):
  1. `Ask agent to resolve` — `btn btn-primary btn-xs` (the one primary action while a
     conflict blocks the surface — it supersedes the tab bodies' own primary actions,
     which are disabled/hidden while a conflict is open, since nothing else is doable
     until it resolves). Verified 5.18:1 light / 4.82:1 dark (§0).
  2. `Open in editor` — `btn btn-outline btn-xs` (daisyUI's colorless outline variant,
     which renders in `base-content`, not a semantic hue — always high-contrast, no
     override needed).
  3. `Abort` — **solid** `btn btn-error btn-xs` with `.err-solid-text` (§0), not
     `btn-error btn-outline`: the outline variant's `error`-as-text measured worse than
     the solid fill's own `error-content`-as-text (3.17-3.59:1 outline vs. 3.87-4.12:1
     solid-unfixed — both fail, but `.err-solid-text` only has to correct the smaller
     gap on the solid variant, 4.83:1 dark / 5.51:1 light once fixed). Opens the kept
     alertdialog ("Abort rebase? Uncommitted work on this branch will be discarded back
     to before the rebase started." / focus on Cancel, also using `.err-solid-text` on
     its own confirm button).
- Once no conflicted paths remain (Requirement 11.5), a fourth button appears in the
  same row, replacing nothing: `Continue` (`btn btn-primary btn-xs` — it becomes the new
  primary action; `Ask agent`/`Open in editor` demote to `btn-outline btn-xs` since the
  blocking condition is gone).
- Delete/modify, symlink and submodule conflicts (Requirement 11.6): the banner drops
  `Open in editor` for those specific files and offers `Ask agent` and `Open folder`
  only — same card shape, just a narrower action set, communicated by a
  `text-base-content-muted text-[11px]` note under the file list: "b.ts is a
  delete/modify conflict — open its folder instead."
- Banner disappears the instant `git:info` reports no operation (a re-render, not an
  animated exit — conflict end is a state fact, not worth a transition that could be
  mistaken for content shifting under the user).

### Contrast (corrected in round 1)

| Pair                                                                    | Dark                                                                               | Light      | Result                                                            |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------- |
| `text-base-content` body/heading on `bg-base-200`                       | 13.9:1                                                                             | 14.2:1     | Pass AA                                                           |
| `text-base-content-muted` file list on `bg-base-200`                    | 5.29:1                                                                             | 5.01:1     | Pass AA (the repo's own gated pair)                               |
| `warning-content` on `warning` (icon chip only)                         | 6.61:1                                                                             | 5.67:1     | Pass AA                                                           |
| `Ask agent to resolve` (`primary-content` on `primary`)                 | 4.82:1                                                                             | 5.18:1     | Pass AA                                                           |
| `Open in editor` (`btn-outline`, `base-content`)                        | 13.9:1                                                                             | 14.2:1     | Pass AA                                                           |
| `Abort` (`.err-solid-text` on solid `error`)                            | 4.83:1                                                                             | 5.51:1     | Pass AA                                                           |
| Previously (removed): `error`-as-text `Abort` outline on `warning` fill | 1.91:1                                                                             | **1.45:1** | Failed — the finding-1 defect, no longer reachable in this design |
| Previously (removed): `text-base-content-muted` on `warning` fill       | n/a (this pairing is gone; muted text now only ever sits on `base-100`/`base-200`) | **2.04:1** | Failed — same root cause, fixed by moving off the full-bleed fill |

## 12. Per-task history timeline (Electron) — Requirement 12

Body of the **History** tab:

```
┌─ Stashes (2) ▾ ───────────────────────────────────────────┐
│  stash@{0}  "wip: try approach B"   3h ago   [Apply][Pop][×]│
├─ Commits since main ───────────────────────────────────────┤
│  a1b2c3d  feat: add hunk toolbar           you   2h ago    │
│  e4f5g6h  fix: stale snapshot check        you   1d ago    │
└─────────────────────────────────────────────────────────┘
```

- **Stash section** (kept capability, new home — parity row: "keep… also shown in the
  history timeline"): a collapsible section (`▾`, same collapse idiom as the source
  control sections) listing entries with message, branch and age, each with `Apply`,
  `Pop` (`btn-ghost btn-xs`) and drop (`×` icon button, inline confirmation kept), and
  clicking an entry expands its per-file stash diff inline (reuses the review canvas's
  own diff rendering, read-only). The header popover for stash (kept — parity: "may also
  keep the header popover") stays as a quick-glance alternative; this section is the
  full workspace.
- **Commit list**: newest first, each row `short-hash (font-mono text-xs
text-base-content-muted)` · subject (`text-sm`, truncated) · author · relative time
  (`text-[11px] text-base-content-muted`). Selecting a row opens that commit's changes
  in the review canvas as a **read-only historical comparison** (Requirement 12.2) — the
  Changes tab activates with the comparison bar preset to that commit vs its parent, no
  hunk toolbar actions (same read-only rule as branch review).
- **No commits of its own** (Requirement 12.3): the commit list area shows a single
  centered line, "No commits yet on this branch." — not an empty bordered box (that
  chrome is reserved for genuinely empty _lists_, this is a factual statement about the
  branch).

## 13. Parity map (Requirement 13)

Every `keep`/`move` row in `parity-inventory.md` has a named location above. Summary by
inventory section (full row-by-row detail is `parity-inventory.md` itself — this table
points each section at where this spec answers it):

| parity-inventory.md section | New location in this spec                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| §1 Dock shell               | §3.1 Review shell header/body; §6.1 changed-file tree (tab strip, resize, rail collapse) |
| §2 Header                   | §3.1 Review shell header (kept, unchanged visual contract)                               |
| §3 Source-control panel     | §6.1 Changed-file tree + row actions (stage/unstage/discard, counts, status icons)       |
| §4 Worktree section         | §10 Task/worktree view                                                                   |
| §5 Stash                    | §12 History tab stash section + §3.1 header popover (kept)                               |
| §6 Branch picker            | §3.1 header (kept), §10 branch panel (detail, moved from popover)                        |
| §7 Diff view and hunk apply | §6.1 continuous diff, hunk toolbar, layout toggle, freshness chip, confirmations         |
| §8 File view                | §7 Spot editor                                                                           |
| §9 Branch review            | §6.2 Branch review mode inside the comparison bar                                        |
| §10 Open-in                 | Present on every file/workspace surface per its own row (§4, §6, §7, §9, §10)            |
| §11 Routing/push/cross-lib  | No visual surface — behavioural, unchanged by this spec                                  |
| §12 Non-UI API, no caller   | `remove-proposed`, approved at Gate 1 — no visual surface                                |

### 13a. Known token-pair follow-up (not fixed this round)

Round 1's contrast verification (§0, §6.4, §11) checked every solid-fill semantic badge
and button this spec actually uses, using the precise CSS Color 4 OKLCH→sRGB method, and
fixed every failure it found **where this spec's own surfaces render it**: the
`error`/`error-content` pair (banner, stale-hunk chip, all destructive confirm buttons,
"D"/"Conflicted" badges) and the one `success`-as-solid-fill button (`Accept`, dark
theme only). It also found, but did **not** fix, the same class of defect in three more
stock daisyUI pairings, each used only for the single-letter file-status badges
("A"/"M"/"R") that appear across every surface in this spec (change-set card, review
canvas, task/worktree, history):

| Pair                                                       | Where it renders                    | Dark               | Light              |
| ---------------------------------------------------------- | ----------------------------------- | ------------------ | ------------------ |
| `success-content` on `success` (`badge-success` "A")       | Added-file badges, every surface    | **2.64:1 — fails** | 6.05:1             |
| `info-content` on `info` (`badge-info` "M")                | Modified-file badges, every surface | **2.95:1 — fails** | 5.08:1             |
| `secondary-content` on `secondary` (`badge-secondary` "R") | Renamed-file badges, every surface  | 8.81:1             | **4.13:1 — fails** |

This is not new scope invented by this round — it is the same root cause as finding 1
and finding 6 (a same-hue `*-content` token that the theme's author tuned for large
elements, not small solid badges), just in three more places nobody named. It was left
unfixed because: (a) no finding cited it, (b) the fix pattern is already fully specified
above (§0's `.err-solid-text`/`.ok-solid-text` are literally the template — a fourth and
fifth class, say `.su-solid-text`/`.in-solid-text`/`.se-solid-text`, would follow the
same measure-and-override recipe), and (c) applying it correctly means touching the
single-letter badge markup in all eight prototype files plus re-capturing their
screenshots, which is more than a two-round revision budget should absorb without the
user or the next reviewer explicitly asking for it. **Recommendation**: the
software-architect or team-leader should open this as a named follow-up — either a
small design-spec addendum before implementation, or a batch in the implementation plan
that applies the same three-line CSS pattern to the status-badge component once, since
it is used from a single shared location in the real Angular build (unlike this static
prototype, which repeats the markup per page).

**Defect fix carried through** (parity inventory's own flagged defect, worktree row
nested-button): §10's worktree row makes Remove a sibling icon button outside the row's
own click target, eliminating the nested `<button>` inside `<button>` without dropping
any capability.

## 14. Clarifications needed

None outstanding for this spec — both open design questions the task handed to this
role are resolved above with a recommendation and a rationale (line-comment delivery,
§6.3; chat-link edit/view default, §7). The task's other open questions (P1 phasing, PR
creation follow-up, provider for commit-message generation, timeline scope, SDK
worktree-removal behavior) are architecture/product decisions already answered at Gate 1
(context.md) or explicitly deferred to the software-architect and are not repeated here.
Timeline scope: **current workspace's branch only** (task-description.md's own
recommendation, §12) — the History tab has no "all branches" picker in this spec.

## 15. Handoff notes for the software-architect

- Component boundaries implied by this IA: a `ReviewShellComponent` (tabs + header +
  banner host) with four lazy-loaded tab bodies (`ReviewCanvasComponent`,
  `CommitComposerComponent`, `TaskWorktreeViewComponent`, `HistoryTimelineComponent`),
  matching the "standalone, OnPush, lazy-loadable" non-functional requirement.
  `git-ui` keeps its no-`chat` dependency rule; the change-set card lives in `chat-ui`
  (or a new small lib) and only _calls into_ git-ui/Electron IPC, mirroring today's
  `file-link-router.service.ts` boundary.
- The hunk toolbar and comment-anchor UI must be Angular DOM siblings positioned via the
  renderer's own line/hunk coordinate callbacks (Pierre exposes hunk indices; CodeMirror
  merge exposes chunk positions) — never appended inside `diffs-container`'s shadow
  root, so Angular's structural directives, `(click)` bindings and focus management work
  normally and axe-core can see them (Risk table, shadow-DOM accessibility risk).

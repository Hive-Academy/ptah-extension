# Context — Skills tab: Electron-only gates vs a documented parity claim

## How this surfaced

Found by TASK_2026_180 batch B1.11, which was writing cross-host e2e for the
provider/model picker extracted into `libs/frontend/ui`. That extraction exists
because of TASK_2026_180's global invariant #5:

> Extract `CuratorModelPickerComponent` into `libs/frontend/ui` and DELETE the
> local copy. Do not fork it — `skill-synthesis-ui` ships to VS Code AND
> Electron, and a fork strands VS Code users.

While proving "renders in both hosts", B1.11 could not reach the surface in the
VS Code host at all. The extraction is still correct — single definition,
`libs/frontend/ui` has other consumers — but that stated rationale is currently
vacuous, because VS Code users are stranded one layer above the picker.

## The contradiction

`libs/frontend/skill-synthesis-ui/CLAUDE.md:16`:

> Unlike memory/cron/gateway tabs, this tab **works in both Electron and VS
> Code** — skills are not desktop-only.

Three gates say otherwise, all verified directly:

1. `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:241`
   — `{ id: 'skills', label: 'Skills', icon: Sparkles, electronOnly: true }`,
   listed alongside `memory`, `cron` and `gateway`.
2. `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts:82`
   — `@if (!isElectron())` wraps a desktop-only placeholder around the
   **entire** template, Settings subview included. `isElectron` is
   `computed(() => this.vscodeService.config()?.isElectron === true)` (`:689-690`).
3. `webview-html-generator.ts:399-401` — the real VS Code host never sets
   `ptahConfig.isElectron`, so it is falsy for a genuine webview.

Gate 1 alone would hide the tab. Gate 2 independently blanks it even if the tab
were shown. They are not redundant by design; nothing ties them together.

## The decision this task has to make

Exactly one of these:

- **The docs are stale.** Skills genuinely is desktop-only — it leans on
  better-sqlite3 (native) and the embedder worker, which is the stated reason
  memory/cron/gateway are Electron-only. Then fix
  `skill-synthesis-ui/CLAUDE.md:16` and stop citing cross-host parity as the
  reason for shared-component extractions.
- **The gates are wrong.** Skills is supposed to work in VS Code. Then establish
  which subviews can function without the native deps, and gate at that
  granularity rather than blanking the tab. Settings/lane configuration is a
  plausible candidate: it is settings I/O, not SQLite.

Do not "fix" this by deleting one gate without answering the question — the
native-dependency reasoning behind the Electron-only tabs is real, and the
answer decides whether the picker extraction has a cross-host consumer at all.

## Scope notes

- Deliberately NOT fixed inside TASK_2026_180. It is not load-bearing for any
  batch there, and it changes what a whole tab does in one host — too big to
  ride along in a feature batch.
- The four lane pickers (`archaeologist`, `synthesis`, `judge`, `replay`) added
  by TASK_2026_180 Phase 1 are among the surfaces currently unreachable in VS
  Code. They are proven to work when bundled into `ptah-extension-webview` and
  driven over the generic `postMessage` transport — see
  `libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/skills-lane-pickers.e2e.spec.ts`
  and its header comment. What is unproven is navigation, not rendering.

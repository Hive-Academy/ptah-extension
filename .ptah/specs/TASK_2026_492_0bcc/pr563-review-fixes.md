# PR 563 review fixes — TASK_2026_492_0bcc

All edits are markdown-only, uncommitted, inside this worktree. Version numbers below were confirmed against `package.json` at the worktree root before editing.

---

## Finding 1 — context.md navigation contract (reload survival)

- **File and line changed:** `.ptah/specs/TASK_2026_492_0bcc/context.md`, lines 42–45 (the finding's "around lines 42–44").
- **Decision taken:** The finding offered two options — define the persistence key and startup hydration path, or weaken the reload-survival statement. **I weakened the statement to require only a stable id.** The persistence key and the startup hydration path belong to TASK_2026_524's remaining batches (batch 4 owns URL persistence); defining them here would either duplicate that specification — which is not present in this worktree — or contradict it. `context.md` states intent, so it now states only what this task owns: id stability.
- **Exact replacement text** (replaces the former item 1 body, which ended "...and an id that survives a reload is what makes a session restorable."):

```markdown
1. Describe navigation as a set of **addressable surfaces**, each with a stable
   id, rather than as a row of tab buttons. The ids become the route table. This
   spec requires only that the id stays stable across releases. Where the active
   id is persisted and how it is restored at startup are not defined here.
```

---

## Finding 2 — design-spec.md `home` / `apps` alias behaviour

- **File and line changed:** `.ptah/specs/TASK_2026_492_0bcc/design-spec.md`, line 24 (the "Design decision — Home and Apps share one page" paragraph), plus the matching mount-table row at line 41.
- **Decision taken:** The finding offered two options — `apps` canonical with `home` redirecting, or one shared `RouteReuseStrategy` key. **I made `apps` canonical and `home` a redirect to it.** A redirect removes the second instance by construction: `home` renders no component tree, so there is nothing to retain, whereas the shared-key option still builds two route entries and depends on `RouteReuseStrategy` internals owned by TASK_2026_524 batch 3. History is stated explicitly: navigating through `home` adds exactly one history entry and its URL is `apps`; no `home` entry is ever written, so Back returns to the previous surface. Layout persistence is unchanged and stays keyed by workspace path only — the edit says so and adds no second key.
- **Exact replacement text** at line 24 (replaces the sentence "Instead: `home` and `apps` render the same component (the Apps page), and `home` is the space's landing route into it."):

```markdown
Instead: `apps` is the canonical route and `home` is a redirect to it. `home` never renders the Apps page itself, so the shell cannot hold two live Apps instances. `home` remains the space's landing address, and the space nav row keeps its Home entry; following that entry — or loading `home` as a URL — lands on `apps`. Navigating through `home` adds exactly one history entry and its URL is `apps`; `home` never appears in history, so Back returns to the surface the user came from. Layout persistence stays keyed by workspace path only — the redirect adds no second persistence key.
```

- **Exact replacement text** at line 41 (mount-table `home` row):

```markdown
| `home` | space | Home | N/A — redirect | `home` redirects to `apps` (see "Navigation sets"); it renders nothing of its own, so it has no mount state and cannot create a second Apps instance. |
```

---

## Finding 3 — focus ownership under RouteReuseStrategy + SURFACE_ACTIVE

- **File and line changed:** `.ptah/specs/TASK_2026_492_0bcc/design-spec.md`, lines 63–76 — a new paragraph inserted directly after the "How 'stays mounted' must be implemented" paragraph (the finding's "around lines 54–60").
- **Decision taken:** The finding did not offer a choice, but it required two answers. (a) **The shell owns focus after a detach**: it moves focus to the newly activated surface's host element (`tabindex="-1"`) after every navigation, because focus cannot survive on a detached element. (b) **The previously focused control is restored** when the Apps surface reattaches and becomes active: Apps records `document.activeElement` when `SURFACE_ACTIVE` goes false (keeping it only if the element is inside the surface), and re-focuses it when `SURFACE_ACTIVE` goes true again, falling back to the host if the element is gone. The surface does the restore because only it knows which inner control held focus; both halves run off `SURFACE_ACTIVE`, since a retained surface gets no `ngOnDestroy`.
- **Exact replacement text** (inserted paragraph):

```markdown
**Focus ownership under retention.** The shell owns focus across every
navigation. When a navigation detaches a retained surface, focus cannot stay on
the detached element — the browser resets it to the page body — so the shell
moves focus to the newly activated surface after each navigation completes: the
surface's host element, rendered with `tabindex="-1"` so it takes focus without
entering the tab order. The surface itself owns its inner focus. The Apps
surface records `document.activeElement` at the moment `SURFACE_ACTIVE` goes
false, and keeps the record only when that element sits inside the surface. When
the surface reattaches and `SURFACE_ACTIVE` goes true again, Apps re-focuses the
recorded control if it is still in the DOM and focusable; otherwise focus stays
on the host the shell focused. Restoration is the surface's job because only it
knows which inner control — a tile expansion target, a filter, the chart/table
toggle — held focus. The record-and-restore runs off the same `SURFACE_ACTIVE`
signal, because a retained surface gets no `ngOnDestroy`.
```

---

## Finding 4 — stale Angular version statement

- **File and line changed:**
  1. `.ptah/specs/TASK_2026_492_0bcc/design-spec.md`, line 7.
  2. `.ptah/specs/TASK_2026_492_0bcc/context.md`, line 20.
- **Decision taken:** No choice offered. Both statements now name the installed versions read from `package.json`: Angular 22.1.7, Nx 23.2.1, TypeScript 6.0.3, Electron 44.4.3, Zod 4.6.5. The stale "Angular 21" prose is gone from both files. The signals, `ChangeDetectionStrategy.OnPush`, Tailwind 3 and daisyui 4 requirements are preserved word-for-word.
- **Exact replacement text**, design-spec.md line 7 (old text began "Installed stack, verified against `package.json` rather than the task text (the task text says Angular 21 ..."):

```markdown
Installed stack, verified against `package.json` (every instruction file was deleted in `7917b193a`, so `package.json` is the only version authority): Angular 22.1.7, Nx 23.2.1, TypeScript 6.0.3, Electron 44.4.3, Zod 4.6.5, Tailwind 3, daisyui 4. Signals and `ChangeDetectionStrategy.OnPush` are mandatory throughout.
```

- **Exact replacement text**, context.md line 20 (old: `- Angular 21, signals, OnPush, Tailwind 3 + daisyui 4. Use the project tokens.`):

```markdown
- Angular 22.1.7, signals, OnPush, Tailwind 3 + daisyui 4. Use the project tokens.
```

---

## Finding 5 — `role="button"` on tiles with nested interactive controls

- **File and line changed:** `.ptah/specs/TASK_2026_492_0bcc/design-spec.md`, line 167 (the finding's line 152; the line number moved after the focus paragraph was inserted) — the "Keyboard entry and exit" bullet.
- **Decision taken:** The finding offered two options for tiles that nest controls — a separate labelled expansion control, or a non-interactive tile container. **I required the separate labelled expansion control** (with the container itself rendered non-interactive: no `role`, no `tabindex`, no key handler). A bare non-interactive container would remove the whole-tile expansion path with no keyboard replacement; the labelled control keeps one resolvable target for keyboard and screen-reader users while a pointer click on the container may mirror it as a secondary path. `role="button"` is restricted to expandable tiles that contain no nested interactive control. The `Retry`, `Reconnect`, `Commit` and `Discard` controls are named explicitly.
- **Exact replacement text** (the full bullet):

```markdown
- **Keyboard entry and exit.** `role="button"` goes on a tile container only when the tile contains no nested interactive control; that container is then the activation target, reachable by `Tab`, activated by `Enter`/`Space` — the pattern `NativeCardComponent` implements (`native-card.component.ts:111-118, 220-228`: `interactive()`/`onKeydown`). A tile that nests an interactive control — `Retry`, `Reconnect`, `Commit`, `Discard` — must not carry `role="button"` on its container: nested interactive elements are unresolvable for keyboard and screen-reader users. Those tiles use a separate labelled expansion control instead — an icon button in the tile header with an accessible name ("Expand {tile title}" / "Collapse {tile title}") and `aria-expanded` — and their container stays non-interactive: no `role`, no `tabindex`, no key handler. A pointer click on that container may mirror the labelled control, but it is never the only path to expansion. Escape closes any expanded tile or modal (already the convention in `QuestionCardComponent`'s custom-input field and the session popovers, `(keydown.escape)="handleCancel()"`).
```

---

## Also record — colour-contrast open question

- **File and line changed:** `.ptah/specs/TASK_2026_492_0bcc/design-spec.md`, line 196 (Open question 4; line number moved after the focus paragraph was inserted).
- **Confirmation:** The open-questions section still reads correctly. The measured-contrast table (lines 182–183) already carries filled `badge-success` at ≈2.64:1 and filled `badge-info` at ≈2.95:1, both marked Fail, and line 187 states that filled `badge-success`/`badge-info` chips fail AA outright. The `anubis` theme is confirmed as the default (`apps/ptah-extension-webview/tailwind.config.js:208`, `darkTheme: 'anubis'`); `anubis-light` exists (`tailwind.config.js:128`) and the open question already recorded that it was never audited. **Change made:** the open question now restates both measured values with their AA verdict inside the question itself, names the `anubis-light` gap explicitly, and references the carrier `TASK_2026_529_b482` so the thread is not lost.
- **Exact replacement text** (Open question 4; old text began "**`anubis-light` contrast.** The measured-contrast table above covers only ..."):

```markdown
4. **Failing badges in `anubis`, unaudited `anubis-light`.** In the default `anubis` theme (dark, `darkTheme: 'anubis'`), filled `badge-success` measures 2.64:1 and filled `badge-info` measures 2.95:1. Both fail WCAG AA. The `anubis-light` theme was never audited: its badge/semantic-token pairs were not computed in this pass (its values are OKLCH, not hex, and hand-converting them was out of this task's effort budget) and need the same audit — ideally via an automated check in the style of `base-content-muted.spec.ts` — before the light theme ships this feature. Tracking carrier: `TASK_2026_529_b482`.
```

---

## Not resolved

None. All five findings and the "also record" item are resolved in the two specification files. `task.md` was reviewed and needed no change: its `status:` line was not touched, its `title:` and `description:` fields are already YAML `>-` block scalars, and no `description:`/`title:` field contains a colon outside a block scalar. No version numbers appear in `task.md`.

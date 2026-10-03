# Batch 50b stream B report: Search & Voice + membership, Gate V 50 findings (TASK_2026_555, track B)

Worktree: `.claude-worktrees/task-555-advanced-search-voice` (head e2032e30a). No git writes. The other developer's files
(output-style/*, pro-features/*, advanced-settings.*) were not touched.

## 1. Finding → fix → spec

Paths are under `libs/frontend/chat/src/lib/settings/`.

| Finding | Fix (file:line) | Spec (file:line) |
|---|---|---|
| Lane FM-2 (moderate): Log out confirm | `license/license-status-card.component.ts:378` `#logoutButton`; `:399` `(keydown.escape)="cancelLogout($event)"` on the `role="group"`; `:435` `#logoutCancel` + testid `logout-cancel-button`; `:470` `effect()` focuses Cancel on open; `:641` `cancelLogout(event?)` returns early when the confirm is closed or the write is in flight, otherwise `stopPropagation()`, closes, and `afterNextRender` focuses Log Out. This is the Batch 49b pattern from `mcp-port-config.component.ts:436-440` | `license-status-card.component.spec.ts:197` (Cancel focused, Esc closes, focus on Log Out, a body listener gets nothing, no RPC); `:223` (Cancel click returns focus); `:239` (Esc while `license:clearKey` is in flight: confirm stays and the event bubbles because it was not handled) |
| Lane FM-4 (minor): go vet Esc | `ptah-ai/go-vet-consent-config.component.ts:267` passes `$event`; `:468` `cancelEnable(event?)` calls `stopPropagation()` only after the "confirm open" guard | `go-vet-consent-config.component.spec.ts:546` (bubbling Esc does not reach a body listener) |
| Lane FM-5 (minor): failed key clear placement | `ptah-ai/web-search-config.component.ts:264-270`: a `role="alert"` line inside the clear `role="group"` (testid `settings-web-search-clear-error-<id>`, dot icon in `text-error`, text `text-base-content`); `:537` the failure sets the new `clearError` signal, not the card-level `errorMessage`; `:503` `requestClear()` and `:512` `cancelClear()` reset it. The toast is unchanged | `web-search-config.component.spec.ts:376` (alert sits inside the group, card alert absent, Cancel then reopen clears it); the D15 case at `:363` and the F1 `it.each` "key clear fails with %s" now assert the inline alert |
| Visual D1 (part): initials | `license/license-status-card.component.ts:362`: `text-primary` → `text-base-content`. `bg-primary/20` stays on the avatar fill | `license-status-card.component.spec.ts:262` |
| Visual D3: "Get API key" links, free-tier size | `ptah-ai/web-search-config.component.ts:171` and the popover's "Get a key" `:225`: `link link-hover` → `link underline` (always underlined, still `text-base-content`); `:168`: free-tier line `text-[10px]` → `text-xs` (12 px) | `web-search-config.component.spec.ts:179` (underline on all three, no `link-hover`); the density case asserts `text-xs` on the line |
| Visual D4: ElevenLabs show/hide target | `ptah-ai/elevenlabs-panel.component.ts:209`: `btn-square min-w-6 min-h-6` (24×24 px, the same utilities as go vet's switch) | `elevenlabs-panel.component.spec.ts:339` |
| Visual M2: slider focus | `ptah-ai/web-search-config.component.ts:294`: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content`, the utility set used in `go-vet-consent-config.component.ts:185` and `ptah-cli-config.component.ts` | `web-search-config.component.spec.ts:189` |
| Visual M3: clipped placeholder | `ptah-ai/elevenlabs-panel.component.ts:201-202`: "New API key" (key stored) / "Paste API key" (no key). The field already has the row header "Replace key"/"New key" and `aria-label="ElevenLabs API key"` | `elevenlabs-panel.component.spec.ts:352` (both states) |

## 2. Contrast and row-height reasoning (D3)

- **Link contrast.** The link text stays `text-base-content` on the card's `bg-base-200`. That is the body-text pair, which the
  gate scanner already passes in both themes. The persistent underline is the non-colour cue that WCAG 1.4.1 accepts, so
  the 3:1 link-to-surrounding-text ratio (2.79:1 measured, dark) is no longer needed.
- **Row height.** In Batch 50a the provider row was 41 px: 8 px cell padding, plus the name line (12 px × 1.5 inherited =
  18 px), plus the free-tier line (10 px × 1.5 inherited = 15 px). `text-[10px]` sets no line height. `text-xs` sets 12 px
  with a 16 px line, so the row becomes about 8 + 18 + 16 = **42 px**. That is still under 48. The Actions cell (one
  24 px `btn-xs` row) is shorter.
- **Width.** The `whitespace-nowrap` line is about 20% wider at 12 px: roughly 230 px becomes about 275 px for "Free tier:
  2,500 searches/month. Get API key". This was not measured, because no Playwright run was allowed. The fold check
  (`SEARCH_VOICE_FOLD_ENFORCED`) and the row ≤ 48 check should be re-run in the next gate.
- **Overflow risk.** The risk is horizontal: the table has `overflow-x-auto`, so a narrower host would scroll sideways
  rather than wrap the row. The wrap that once made rows 63 px came from the description, which is no longer visible.

## 3. Counts

- Findings fixed: 8 (FM-2, FM-4, FM-5, D1-part, D3, D4, M2, M3).
- Source files changed: 4. Spec files changed: 4.
- New specs: 11.
- Updated assertions: 3. They sit in the D15 clear case, the F1 clear `it.each`, and the density case.
- Counted lines (non-spec, all ≤ 700): license-status-card 690, web-search-config 659, elevenlabs-panel 673,
  go-vet-consent-config 570.

## 4. Verification

| Check | Result |
|---|---|
| `npx jest -c libs/frontend/chat/jest.config.ts --maxWorkers=2` on the 4 suites | 4 suites, **137 passed** |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=2` | 2 tasks successful |
| `npx eslint` on the 8 touched files | no output (0 errors, 0 warnings) |
| Build / Playwright scene / fold | not run (the brief does not allow it) |

## 5. Deviations

1. **FM-5: the failure is shown inline only.** It moved into the confirm group instead of appearing in both places. Two
   `role="alert"` regions would announce the same sentence twice. The alert toast still fires through `saveGeneric`.
2. **Web search Clear Esc now stops propagation**, via `cancelClear(provider, $event)` and the guard at `:512`. This was
   not listed as a finding. I applied it so the confirms in this stream match the Batch 49b pattern. It is pinned by
   `web-search-config.component.spec.ts:398`.
3. **M3: the no-key placeholder was shortened too**, to "Paste API key". "Paste your ElevenLabs API key" is 29 characters
   and the clipped field showed only about 24.
4. **FM-2: Esc and Cancel do nothing while a log-out write is in flight.** Cancel was already disabled then. Esc passes
   through unstopped in that state, because it was not handled.

Out of scope, not touched: the "At least one provider must stay selected." and "per search" lines in web-search-config
are still `text-[10px]`. D3 named only the free-tier line.

## 6. Addendum: user decision at Gate V 50 (2026-10-02)

The FM-5 inline-only alert (deviation 1) and the web search Clear Esc `stopPropagation` (deviation 2) were accepted.

| Decision | Fix (file:line) | Spec (file:line) |
|---|---|---|
| Resting Clear buttons are neutral; red only on the confirm button (P8) | `ptah-ai/web-search-config.component.ts:250` and `ptah-ai/elevenlabs-panel.component.ts:134`: `btn btn-outline btn-xs border-error text-base-content` → `btn btn-outline btn-xs text-base-content`. This is a neutral outline in base-content colour with no red border. The confirm buttons ("Clear key") keep `border-error`. The aria-labels, testids, confirm-first behaviour and lack of Undo are unchanged. The size stays `btn-xs` (24 px), so the row height is unchanged (about 42 px, ≤ 48) | `web-search-config.component.spec.ts:333` (resting Clear has no `border-error`, has `btn-outline`/`btn-xs`/`text-base-content` and the same aria-label; the confirm button has `border-error`); `elevenlabs-panel.component.spec.ts:368` (same assertions) |
| "At least one provider must stay selected." and "per search" at 12 px | `ptah-ai/web-search-config.component.ts:288` and `:297`: `text-[10px]` → `text-xs` | `web-search-config.component.spec.ts:189` |

The note under the matrix grows from about 15 px to 16 px. The slider bar is already taller than its 12 px labels because of the badge and the range input. Neither change affects the provider rows. The fold should still be re-measured in the next gate run.

**Verification (re-run)**

| Check | Result |
|---|---|
| `npx jest -c libs/frontend/chat/jest.config.ts --maxWorkers=2` on the 4 suites | 4 suites, **138 passed** |
| `npx eslint` on the web-search-config and elevenlabs-panel source and spec files | no output (0 errors, 0 warnings) |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=2` | **lint passed**: 0 errors; the 30 warnings are all in files outside this stream. **typecheck FAILED**, but only in `output-style/output-style-config.component.ts:97`: TS2339 `error` does not exist on `OutputStyleStore`, and NG8002 `[error]` on `ptah-output-style-list`. That file belongs to the other developer's in-progress batch. The same command passed before this addendum, and no error is in a file from this stream. |

## 7. Addendum: team-leader finding, helper text below 12 px

| Finding | Fix (file:line) | Spec |
|---|---|---|
| Membership key field label and hint | `license/license-status-card.component.ts:156`, `:193`: `text-[11px]` → `text-xs` | `license-status-card.component.spec.ts`, guard test (last test) |
| ElevenLabs key hint, voices locked / loading / error | `ptah-ai/elevenlabs-panel.component.ts:253`, `:294`, `:301`, `:309`: `text-[10px]` → `text-xs` | `elevenlabs-panel.component.spec.ts`, guard test |
| go vet loading line, confirm root path (mono) | `ptah-ai/go-vet-consent-config.component.ts:204`, `:283`: `text-[10px]` → `text-xs` (the path keeps `font-mono break-all`) | `go-vet-consent-config.component.spec.ts`, guard test |
| go vet card description (visual m1) | `ptah-ai/go-vet-consent-config.component.ts:101`: `text-[10px]` → `text-sm` (14 px) | `go-vet-consent-config.component.spec.ts`, "sets the card description at 14 px like the sibling cards (visual m1)" |
| Web search key popover hint, inline code `ptah_web_search` | `ptah-ai/web-search-config.component.ts:222`, `:131`: `text-[10px]` → `text-xs` | `web-search-config.component.spec.ts`, guard test |

**Guard.** Each of the 4 spec files ends with "uses no text size below 12 px anywhere in the component source (Batch
50b)". The test reads its own component source with `readFileSync(join(__dirname, ...))`, following the precedent in
`output-style-editor.component.spec.ts:584`. It expects no match for `/text-\[(?:\d|1[01])(?:\.\d+)?px\]/g`, so any
`text-[Npx]` below 12 px fails it. A grep of the 4 component files now finds no `text-[9px]`, `text-[10px]` or
`text-[11px]`.

**Fold and row height.**
- No change touches a web search provider row; they stay at about 42 px, ≤ 48.
  - `:131` is inline code inside the 12 px description, which already has a 16 px line, so the line height does not
    change.
  - `:222` is inside the key popover.
- The go vet card is taller because its description is now 14 px with a 20 px line. That card renders after the voice
  card (`search-voice-settings.component.ts:20-24`), so it cannot push the web search card or the voice rows that the
  fold check measures.
- None of this was measured in a browser, because no Playwright run was allowed.

**Verification (re-run)**

| Check | Result |
|---|---|
| `npx jest -c libs/frontend/chat/jest.config.ts --maxWorkers=2` on the 4 suites | 4 suites, **143 passed** |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=2` | "Successfully ran targets typecheck, lint". The section 6 output-style typecheck error is gone. Lint has 0 errors; the 30 warnings are all in files outside this stream |
| `npx eslint` on the 8 files of this stream | no output (0 errors, 0 warnings) |
| Counted lines (non-spec) | 690 / 659 / 673 / 570: unchanged, all ≤ 700 |

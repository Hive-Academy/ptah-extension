# B4 — transcript session entrance

## Changes

- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:330,390,1083-1147,1426-1457`: added the default-false `entering` input, one rising-edge after-render selection, D11 pinned viewport projection, bounded newest-first slot measurement, write-phase marking, and falling-edge/destroy cleanup. The selection is a one-time snapshot; later stream, replay and resync slots cannot acquire marks.
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-slot.directive.ts:33`: exposes its persistent wrapper element.
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-entrance.ts:2`: pure newest-visible selector, cap and early-stop behavior.
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html:35-42`: documents the persistent entrance target.
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.css:1-20`: uses global motion tokens for a 200 ms translateY/opacity turn entrance and 160 ms pane fade, with reduced-motion cancellation; removed local token copies.

The animated message element is the persistent `.chat-msg-slot` `<div>` carrying `data-ptah-transcript-message-id`. The same element receives `.ptah-turn-enter`, `data-enter-i="0"` through `"5"`, and inline `--i`. The measurement probe should target that wrapper. For an unpinned restored offset, `.chat-scroll-container` receives `.ptah-pane-enter` and no slot mark.

## Spec coverage

- `transcript-entrance.spec.ts:8-43`: tall final reply; fewer than six; more than six/cap; partly visible top; scrolled-up viewport; empty/zero cap; stop before reading older items.
- `chat-transcript.session-enter.spec.ts:52-186`: retained B with hidden append; tall final reply with pre-restore `scrollTop=0`; fewer than six in a long pinned thread; non-retained empty load and replay; rapid A→B→A with cleanup; unpinned pane fade; streaming append and resync replacement; destroy cleanup. The host binds real transcripts to `active` and `entering`; geometry is stubbed on the scroller and persistent slots because jsdom has no layout.

## Verification

- Ran `ptah_get_diagnostics` scoped to the five changed TypeScript files after the final edits: clean coverage and **no diagnostics in requested files**. The tool also reported 266 errors in sibling chat project files outside B4 ownership. It does not check HTML/CSS. One intermediate diagnostics call timed out; the subsequent call completed.
- Per instruction, did not run Nx, Jest, build, serve, dev, or e2e while another heavy check was active. The orchestrator should run these exact checks, one at a time:

```powershell
npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/transcript/transcript-entrance.spec.ts libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.session-enter.spec.ts libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.replay-motion.spec.ts --coverage=false --maxWorkers=2
npx nx typecheck @ptah-extension/chat --parallel=1
npx nx lint @ptah-extension/chat --parallel=1
```

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Mark the existing `.chat-msg-slot` wrapper directly. | New wrapper; child bubble mark. | U5 and the M0 probe target `.chat-msg-slot`; the wrapper persists through virtualization. | Yes. |
| Project the pinned viewport by `scrollHeight - clientHeight - scrollTop` in `earlyRead`. | Live viewport; wait for restore frame. | D11 and `restoreScrollOnActivation()` use a later rAF. | Yes. |
| Pre-resolve the selected elements in `earlyRead`, then only mutate them in `write`. | Resolve IDs against every slot during `write`. | The approved phase contract separates geometry/selection from writes and caps the measured set at six. | Yes. |

## Clarifications Needed

None.

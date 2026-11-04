# Batch 14 report

## Files written

- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/chat/src/lib/settings/providers/connection-drawer/codex-sign-in-block.component.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/chat/src/lib/settings/providers/connection-drawer/codex-sign-in-block.component.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/chat/src/lib/settings/providers/connection-drawer/credentials-tab.component.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/chat/src/lib/settings/providers/connection-drawer/credentials-tab.component.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/chat/src/index.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/.ptah/specs/TASK_2026_864_1376/batch-14-report.md`

## State mapping

| Design 5.5 | Service snapshot | Block presentation |
| --- | --- | --- |
| 1 | null, installed command | Sign in, browser hint, `codex login` terminal row |
| 1b | null, bundled command and flag | Sign in, quoted full-path terminal row and bundled explanation |
| 2 | starting | Static/spinning loader, starting copy, cancel in panel |
| 3 | running/awaiting-user with URL and code | Waiting copy, validated HTTPS link, selectable and copyable code |
| 4 | running/awaiting-user without URL/code | Neutral running copy, no browser claim |
| 4b | no URL/code and `nothingSeen()` | Recovery copy; restart in browser/device mode; cancel in panel |
| 5 | URL only | Waiting copy and link actions, no code box |
| 6 | succeeded | Signed in/checking copy; readiness confirmation belongs to host |
| 8 | failed except timeout | Fixed error-code copy, exit code when present, Try again |
| 9 | cancelled | Information copy and Sign in again |
| 10 | failed with timeout code | Timeout copy and Try again |

The credentials tab now embeds the compact block. Its existing external action emits `sign-in` from “Sign in with Codex” and `sign-in-cancel` while the service reports a running phase.

## Accessibility

- Chosen failures use `role="alert"`; information-only failures and all other active/final notices use polite `role="status"`.
- Device codes have a character-by-character accessible label (including spoken “dash”) and remain selectable text.
- Link rendering revalidates HTTPS, uses `rel="noopener noreferrer"`, and copy actions report success or failure.
- Progress loader animation is gated by `prefers-reduced-motion: no-preference`; the shape remains static otherwise.
- Browser-open success/failure text appears only with explicit `browserOpened` true/false.

## Decisions

- Compact layout omits the block's ready/start and running/cancel controls because the credentials tab owns those action events. The panel layout owns them directly. This keeps the existing drawer action contract; reversible if other compact hosts need their own controls.
- Host `error` and raw CLI output are not rendered. The typed error code and exit code generate fixed, user-facing copy, because the snapshot does not contain a safe output transcript. Reversible if a sanitized transcript contract is added.
- The service's `nothingSeen()` determines state 4b; it owns the 20-second timer and its cleanup. Reversible if the service changes that threshold.

## Verification and risks

- `ptah_get_diagnostics` reported no diagnostics in the five changed TypeScript files. It reported 306 errors in sibling chat files; the orchestrator's verify run remains authoritative.
- No Jest, Nx, verify, build, app, or browser command was run, per the caller's sandbox instruction.
- In a compact host without its own start/cancel controls, the block presents progress and recovery but cannot start or cancel a running attempt. The credentials tab supplies both actions; chat and onboarding callers must account for their own compact action wiring.
- Design state 3's expiry text and state 8's collapsible output cannot be rendered from the current `CodexLoginState`, which has neither expiry nor sanitized output fields. The host contract would need those fields.

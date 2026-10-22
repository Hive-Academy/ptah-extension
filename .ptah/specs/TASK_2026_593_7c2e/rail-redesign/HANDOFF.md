# HANDOFF - TASK_2026_593 attention follow-ups (context label, rail redesign, badge removal)

Written 2026-10-21 by orchestrator session `notification-fixes` (continued from
`.claude-worktrees/attention-visual-2/.ptah/specs/TASK_2026_593_7c2e/HANDOFF.md`, now removed;
its content is superseded by this file).

## Goals

1. User bug: bell rows and snackbars for questions/permissions showed "Unknown workspace" and
   never the session name. -> PR #795.
2. User feedback: cards "look old and very rigid", the canvas rail lost its live questions,
   and a floating round warning-triangle button should be gone. User decisions:
   - Do NOT revert 593/702. Keep the bell + OS notifications, RESTORE a compact "Needs you"
     queue in the canvas rail, REDESIGN the cards (prototype approved by the user).
   - Rename the chat-owned "Open" action to "Show in canvas" (surface-owned rows keep "Open").
   - Remove the floating permission badge (`ptah-permission-badge`).

## PRs and branches

| PR / branch | Worktree | Head | State |
| --- | --- | --- | --- |
| **#795** `fix/attention-context-label` | `.claude-worktrees/attention-context-label` | `9c7dd338e` (pushed) | OPEN, CI **green** (17 pass). Ready for the user to merge |
| `feat/attention-rail-redesign` (stacked on #795) | `.claude-worktrees/attention-rail-redesign` (node_modules junction) | `b59a8a6f4` + uncommitted lane work | **NOT pushed yet** (waited for the machine slot). Next session: verify, commit, push, `gh pr create --base fix/attention-context-label` (or `main` after #795 merges) |
| #792, #793 | removed worktrees | merged | done |
| #798 `docs/verify-via-ci` | `.claude-worktrees/verify-via-ci` | `615f4b26f` | CLOSED (user wanted the rule temporary only; moved to the user's global CLAUDE.md TEMPORARY section, expires 2026-10-24). Branch is on GitHub. Remove the worktree only when the user says |

Other worktrees from earlier sessions stay until the user says (`attention-pr780`, `chat-start-screen`).

## Done

### PR #795 (commits on `fix/attention-context-label`)
- `be63fa943` context line (provider, session title, `Tool: X` / question preview); workspace
  label for unpartitioned tabs; session-id lookup searches the active set with no active path;
  Open for unpartitioned owners routes by tab id.
- `66105961a` host projection title = kind label, session title in context; shared
  `attention-context.util.ts` (unsafe paths/keys filter, 80-char cap that keeps `Tool: X`);
  dispatcher accepts `''` path with a tab id; failed canvas adoption reports `missing`;
  "Show in canvas" label for chat-owned rows (incl. failed-turn notice).
- `cba33d9e8` merge of origin/main; `9c7dd338e` neutral Needs-you row border, uppercase
  section headers with right count, fixed visual-check script, visual reviews 2 and 3.
- Reviews: Anthropic code-logic APPROVED 8/10 (`../code-logic-review-context-label.md`).
  CodeRabbit: 7 comments replied (6 fixed, #7 partly: tile-cap focus needs
  `orchestra-canvas.component.ts`, off-limits for 593).
- Visual run 3 (`../visual-review-3.md`): 22/22 shots; the LIVE permission row shows
  "Attention capture · Tool: Bash" and workspace "workspace" with Show in canvas enabled
  (`../visual-check/{dark,light}-panel-permission-live.png`, PNGs git-ignored).

### Redesign (branch `feat/attention-rail-redesign`)
- Design: `design-spec.md`, `prototype/attention.html` (user APPROVED; PNG at
  `prototype/screenshots/full.png`, git-ignored; the HTML lacks `<meta charset="utf-8">`, so
  icons render as mojibake - cosmetic).
- `ef3a7ae7d` `AttentionItem.sessionTitle/provider/detail`; new shared card (snackbar + bell);
  canvas Sessions panel "Needs you" queue + rail card chip, via core `NotificationService` and
  `ATTENTION_ACTION_DISPATCHER` (key + generation).
- `b59a8a6f4` one exclusive primary per request in the rail; Needs-you block inside the card
  frame; kind label first in queue cards; snackbar stack bottom-right (5rem), 3 / 1 by width.
- Reviews: grok code-logic APPROVED 8/10 after 2 rounds (`code-logic-review.md`).
  Visual review 1 (`visual-review.md`) REVISE 4/10 -> its 3 defects fixed in `b59a8a6f4`;
  a second visual run has NOT been done yet.

## In progress at handoff

- Codex lane `810b108c-efa8-40f4-9e71-208b76fa3bde` (working in the redesign worktree,
  uncommitted): enable Allow/Deny for a pending permission whose tab is closed (answer through
  the same `handlePermissionResponse` path the badge uses; stale -> refused), then remove
  `ptah-permission-badge` (chat-view.component.html:137, chat-view.component.ts:37,181,
  chat/components/index.ts:89, chat-ui/src/index.ts:104, component + spec). Deliverable:
  `lane-no-tab-answer.md`. Background: `lane-remove-permission-badge.md` (preserve check that
  blocked a plain removal). See "Lane result at handoff" at the end.

## Open problems and decisions

1. Accepted minors (follow-ups): snackbar Tab order runs bottom-up (`flex-col-reverse`,
   notification-snackbar.component.ts:28); a stale snackbar keeps its buttons enabled (the
   dispatcher refuses the second answer); `switchWorkspace('')` on a stale tab
   (notification-focus-coordinator, pre-existing); no-provider context cap drops `Tool: X`;
   bare words like `/dev` dropped as paths; host projections have no detail line (wire has no
   tool/question field).
2. Later tasks proposed, not started: M7 ActionBanner API cleanup; M8 Open routability at
   projection time; M4 git warning while the dock is closed (needs a user design decision,
   conflicts with decision #43).
3. Coverage gaps in visual runs: live lane agent, git-status warning, backend failed turn.
4. The user asked: is OS notification for questions the core goal? The record (`task.md`) shows
   593 started as "unify inline notices"; OS notifications were added in scope. Keep OS
   notifications working; do not remove in-app surfaces (user decision).

## Key files

- Redesign task folder: `.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/rail-redesign/`
- 593 task folder (parent): `.ptah/specs/TASK_2026_593_7c2e/` (decisions.md, design-spec.md,
  parity-inventory.md, task-description.md, visual-check/shoot-populated.cjs)
- Cards: `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts`,
  `notification-center.component.ts`
- Rail: `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts`,
  `canvas-rail-card.component.ts`, `rail-attention-action.ts`
- Sources/actions: `libs/frontend/chat/src/lib/services/chat-attention-source.service.ts`,
  `chat-attention-host-message-handler.service.ts`, `chat-attention-action-dispatcher.service.ts`,
  `attention-context.util.ts`, `notification-focus-coordinator.service.ts`
- Types/tokens: `libs/frontend/core/src/lib/services/attention.types.ts`,
  `notification.service.ts`, `tokens/attention-action-dispatcher.token.ts`
- Badge: `libs/frontend/chat-ui/src/lib/molecules/permissions/permission-badge.component.ts`

## Next steps

1. Read `lane-no-tab-answer.md` and `git -C .claude-worktrees/attention-rail-redesign diff`.
   If the lane failed or wrote nothing, resume it (CLI Session ID from `ptah_agent_status
   810b108c-...`) or respawn with the brief in this file's "In progress" section.
2. Independent review of that change by a non-codex family (grok has room; resume session
   `01a15b3e-bcc1-7382-81b6-f48909adb8d1` or spawn fresh with role `code-logic-reviewer`).
   Focus: the backend response for a no-tab answer is identical; stale refusal; nothing else
   used the badge.
3. Commit in the foreground in the redesign worktree (scopes from `.commitlintrc.json`, e.g.
   `feat(chat,chat-ui): answer tabless permissions, remove permission badge`).
4. Machine slot: ask peers (ListAgents + SendMessage) for "Electron: free" + "checks: free";
   queue at handoff was 707 -> lane-mcp-connect (show-worktree-file session) -> this work.
5. Electron visual run 2 of the redesign on a codex `visual-reviewer` lane (build once +
   `node .ptah/specs/TASK_2026_593_7c2e/visual-check/shoot-populated.cjs`; may resume
   `01a15b2e-7313-7780-a3f7-9dd0d512814c`). Check: rail primary filled, Needs-you block inside
   the card, bottom-right stack does not cover Stats, no round badge, dark + light.
   Show the user `visual-check/{dark,light}-rail-needs-you.png` and a snackbar shot.
6. Push + PR in one background command, then send "checks: free" to the next peer:
   `git push -u origin feat/attention-rail-redesign && gh pr create --base fix/attention-context-label --title "feat(notification-center,canvas,chat): attention card redesign and rail queue" --body ...`
   (use `--base main` if #795 is merged by then). Ask the user to merge #795 first.
7. Propose the follow-ups in "Open problems" 1-2 to the user.

Verification (temporary user rule until 2026-10-24: let hooks and CI check; no local
typecheck/test before commit or push; local checks only to reproduce a CI failure):

```bash
gh pr checks 795
gh pr checks <redesign PR>
# only to reproduce a CI failure, one at a time, after a "checks: free" slot:
npx jest -c libs/frontend/<lib>/jest.config.ts <failing spec> --coverage=false --maxWorkers=2
npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | tail -1   # must stay <= 291
```

## Standing rules

Orchestration + agent-lanes skills. Codex CLI lanes implement (`ptah_agent_list` before
every spawn, never AT LIMIT, max 3 lanes; lanes run no nx/jest/tsc/lint/build unless the brief
says so). Reviews by a different family than the implementer: user is at ~94% Claude usage,
so use grok lanes for code-logic reviews (user's temporary rule: CLI lanes first, no Claude
subagents, until 2026-10-24). One heavy job at a time on the machine: coordinate with peers
via ListAgents/SendMessage ("checks: free", "Electron: free"); announce Electron launches.
Never `text-base-content/NN`. Degradation audit <= 291. Commit in the foreground with hooks,
push + `gh pr create` in the background, no `--no-verify`. Do not poll lanes; act on the
pushed completion signal. Never pass an invented `resume_session_id` (this session made that
mistake once; the stray lane `92a9cc51` failed harmlessly). No local-only branches at the end.

## Lane result at handoff

Lane `810b108c` ended normally (exit 0, deliverable `lane-no-tab-answer.md` written; CLI
Session ID `01a15b58-a9cb-7712-8c0a-7fdae3dd8c45` for review fixes). It is
**uncommitted and NOT reviewed** in the redesign worktree:

- `chat-attention-source.service.ts:156-161` enables Allow/Deny for a queued session permission
  without a tab (Unknown tool and Show in canvas stay disabled when nothing can open).
- `chat-attention-action-dispatcher.service.ts:33-37,80` checks the request is still pending and
  passes an optional tab to `AgentPermissionResponder`, which calls the same
  `PermissionHandlerService.handlePermissionResponse({ id, decision })` the badge used
  (`chat.store.ts:482-484`, `permission-handler.service.ts:431-436` -> `SDK_PERMISSION_RESPONSE`).
- Removed: badge block in `chat-view.component.html`, its import in `chat-view.component.ts`,
  exports in `libs/frontend/chat/src/lib/components/index.ts` and
  `libs/frontend/chat-ui/src/index.ts`, and `permission-badge.component.ts` (no spec existed).
  `unmatchedPermissions` kept (other readers).
- Specs added: `chat-attention-source.service.spec.ts:102`,
  `chat-attention-action-dispatcher.service.spec.ts:69-78`, `agent-permission-responder.spec.ts:90`,
  `chat-streaming/.../permission-handler.service.spec.ts:160`.
- Touched projects for CI: chat, chat-ui, chat-streaming (plus the earlier notification-center,
  canvas, core in this branch).

Next session starts at "Next steps" 2 (review), because step 1 is done.

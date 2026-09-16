# TASK_2026_449 — Peer session name sync

## User intent

> Why do we still have a session name in Ptah that is different from the one
> the agent gets when it tries to send a peer message? ... It would be awesome
> if we can make sure we link the same session name we have in Ptah to the same
> one we save on the Claude agent SDK itself.

Screenshot evidence: canvas tiles titled "branch view", "layout enhancements",
"continue app lag 22", "continue task". The "Message Peer Session" picker shows
`ptah-ptah-extension-branch-view-0b8a10`, a `website-manager` row flagged
"other workspace", and a disabled row with "process identity mismatch".

## Findings (orchestrator investigation, 2026-09-15)

`ListAgents` from a live Ptah session returned the same six names as the picker.

1. `buildSessionName` (`libs/backend/agent-sdk/src/lib/helpers/session-name.builder.ts:92`)
   composes `ptah-<workspace>-<role>-<suffix>`, where `role` is the user's
   session name at spawn (`sdk-query-options-builder.ts:1036-1085`,
   `extraArgs['name']`).
2. `--name` is written by the CLI into `~/.claude/sessions/<pid>.json` at
   spawn and is FIXED for the process life. No documented API changes it.
3. A rename in Ptah goes through `SessionTitleService` / SDK `renameSession()`
   and changes the transcript title only — the registry name drifts.
   Example: `ptah-ptah-extension-we-have-an-issue-in-the-team-builder-dc3acf`.
4. Cross-workspace rows are deliberate (`peer-session-directory.service.ts:7-34`,
   policy `include-all-workspaces`). NOT in scope to change.
5. "process identity mismatch" is a stale pid record. NOT in scope.

## Decided approach (user approved)

- **Part A — picker label (frontend + directory).** The peer directory joins
  each registry row to `SessionMetadataStore` by SDK session UUID and adds the
  current Ptah title (e.g. `displayName`) to `PeerSessionRow`. The picker shows
  the Ptah title as the primary label and the registry name (the address) as
  secondary text. Rows with no Ptah metadata show the registry name only.
- **Part B — rename reaches the registry (backend).** When a live Ptah session
  is renamed, restart its CLI process through the existing resume path so the
  new `--name` is applied (`sdk-agent-adapter.ts:810-826` already reads the
  stored name on resume). Keep the same unique suffix so the address stays
  recognisable. If a turn is in flight, defer the restart until the turn ends.
  Never restart a session with running subagents or background work mid-flight.
  A restart failure must never cost the session: log at `warn`, keep the old
  process.

## Outcome (2026-09-15)

- **Part A shipped.** `PeerSessionRow.ptahTitle` is joined from
  `SessionMetadataStore.getAll()` in `PeerSessionDirectory`. The picker shows
  the title as the primary label and the registry name as secondary text.
- **Part B dropped (user decision), replaced by a rename hint.** A live
  restart cannot keep the old process on failure: `SessionRegistry.register`
  overwrites the tab entry (`session-registry.service.ts:162`), spawn and auth
  errors surface only in the stream, and a zero-event resume ends the session.
  Ending a session also fires the session-end fan-out (memory curator, skill
  synthesis) on every rename. Live model, effort and permission changes would
  be lost.
- **Rename hint.** When the slug of `ptahTitle` does not match the registry
  name, the picker shows `renamed · address updates on next resume`. That
  text is true: `session:rename` writes `metadataStore.rename`
  (`session-rpc.handlers.ts:553`) and resume reads it into `--name`
  (`sdk-agent-adapter.ts:810-826`) with the same tabId suffix.

## Out of scope

- Writing `~/.claude/sessions/<pid>.json` directly (internal CLI format).
- Changing the cross-workspace inclusion policy.
- Sessions Ptah did not start.

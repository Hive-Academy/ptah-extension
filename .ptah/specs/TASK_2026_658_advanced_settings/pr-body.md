## Summary

Adds an "Advanced settings" area to the Settings tabs (TASK_2026_658). It shows the numeric and
boolean tuning keys (context budgets, internal queries, scheduled jobs, harness sync and more) with
the user-approved A1 limits from one shared table (`libs/shared/.../advanced-settings.types.ts`).

- Backend: the shared table drives the defaults and bounds, and `settings:get` / `settings:set`
  validate against it (shared, platform-core, rpc-handlers).
- Frontend: grouped fields per tab in a closed "Fine-tuning" section, live or "Restart Ptah to
  apply" notes, client-side range checks, bounded reads, and no raw host error text.
- Review fixes: codex code-logic review R1 6/10, fix round, R2 APPROVED.
- Visual fixes: number-field errors use an error colour, an error border visible in both themes and
  `role="alert"`. The boolean toggle text follows the saved value (Enabled / Disabled). A fresh
  visual re-check passed in dark and light at 360 and 1000 px.
- Help text of `compaction.subagentHandoffTokens` now says that the subagent is stopped and handed
  off (it said "summarised").

## Known follow-ups (not in this PR)

- Code review Moderate 3: a malformed success read without `value` looks ready.
- Visual Moderate 2: the 9 px "Restart" badge is small.
- Visual Moderate 4: card in card, and an empty status row.
- Visual Minor: no thousands separators, "Saved {label}." grammar, faint chevron.
- A light-theme `.input` rule in `styles.css:2130-2136` hides daisyUI `input-error` borders in
  other screens too (for example the output-style editor).
- Backend: no spec ties harness-sync `DEFAULT_PREFLIGHT_TIMEOUT_MS` / `DEFAULT_MANAGE_GITIGNORE` to
  the shared table.

## Test plan

- [x] `nx run-many -t typecheck,lint,test` for shared, platform-core, memory-curator,
      rpc-handlers and chat (chat re-checked after the visual fix: typecheck, lint and 82 targeted
      specs).
- [x] Visual re-check: number-field error state and boolean toggle text, dark + light, 360 + 1000 px
      (`TASK_2026_658_advanced_settings/visual-recheck.md`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

# Code Logic Review - TASK_2026_852_e271

Review family: anthropic (in-process Claude) - implementer family: codex

Score: 7/10. Verdict: REVISE (skill text only; code logic is sound). Static review, no tests or builds run.

## Defects

1. SERIOUS - `.claude/skills/tribunal/SKILL.md:52-54` (and the byte-identical plugin copy `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/SKILL.md`).
   The Relay paragraph has literal `?` characters where non-ASCII glyphs were lost to an encoding round-trip: `**Relay ? phased lane workflow.**`, `plan ? architect ? implement ? review`, and a line starting `? [references/relay.md]`. This text ships to every user and agent, and the mirror parity check cannot catch it because both copies are corrupted the same way.
   Fix: restore the intended characters. Use ASCII `-` and `->` or a real em dash and arrow. Rewrite as "**Relay - phased lane workflow.** ... plan -> architect -> implement -> review ... See [references/relay.md]". Apply it to both copies and re-run `cmp`.

2. SERIOUS - `.claude/skills/tribunal/references/crucible.md:51-52` and `:120` (plus the plugin mirror).
   Item 6 was applied to SKILL.md, vendor-panel.md and relay.md only. crucible.md still says:
   - "UI role tokens `(executor)` / `(judge)`".
   - "UI lanes without tokens - the first lane executes, the last judges".
   - "or use the folder the UI framing names" (line 120).
   - A link to `vendor-panel.md#0-explicit-panel-from-the-tribunal-ui`. That anchor no longer exists, because the heading is now "0. Explicit panel from the user", so the link is dead.

   Line 52 also contradicts the new vendor-panel.md section 0: "Do not infer an omitted role from lane order". Following crucible.md, an agent would silently infer executor and judge from lane order.
   Fix: rewrite the two lines to say:
   - Plain-text role pins from the user are authoritative.
   - If a role is omitted, ask the user. Do not infer it from lane order.
   - Link to `#0-explicit-panel-from-the-user`.

   Replace "the UI framing" with "the user's named folder". Mirror to the plugin copy.

3. MODERATE - `libs/backend/task-specs/src/lib/task-index.service.ts:410` (`readRoundJudge`).
   After the RPC handler was removed, the method has no non-spec caller (`git grep readRoundJudge`). It is kept deliberately under item 4, but nothing exercises it outside its own spec, so it is now dead and untested through any real entry point.
   Fix: either note it as retained for the artifact reader (a one-line comment) or schedule its removal in a follow-up. No functional change is needed now.

4. MINOR - `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:129`.
   A host that passes `initialView: 'tribunal'` now throws "Invalid initialView". I found no host caller that sends it (`git grep` on `'tribunal'` is clean), so this is correct for retirement. Renderer-side persisted or stale values are safe: `normalizeInitialView` (`app-state.service.ts:789`) falls back to chat with a console warning, and `requestSurface` now normalizes (`:586`), covered by the spec at `app-state.service.spec.ts:623`. No fix needed. Recorded for completeness.

## Checked and found clean

- **Forbidden files.** `tab-manager.service.ts`, `message-sender.service.ts`, `session-context.token.ts` and `session-loader.service.spec.ts` are not in `git status`. The remaining mentions of "tribunal" in those files are untouched pre-existing comments.
- **Generic Command Center behaviour.** I compared `main:command-center-roster.provider.ts` with the new `command-center-question.provider.ts`. These are all preserved:
  - ordinary-question matching (`tabId || sessionId`, first question present);
  - permission lookup (a request with a `tabId` matches only that tab, otherwise it falls back to `sessionId`);
  - permission-over-question priority in `shownInput`;
  - `setPendingInput` mapping;
  - the once-only voice prompt via `spokenRequestIds`;
  - the idle check (`isIdleWithoutPendingRequest` is identical apart from the rename).

  The Confirm-option filtering, the invalid-proposal decline/retry loop, the timeout path and the grace timers are Tribunal-only and correctly removed. `ordinaryChoices` no longer filters confirm/yes options, which is correct without a roster flow.
- **Controller wiring.** `command-center-page.controller.ts` uses the new provider. The voice callback is a lazy arrow (`this.voice.onPendingPrompt`), so there is no use-before-init. `teardownSessionState()` no longer takes `pageLeave`. No dangling `onRoster*`, `setRosterPending` or `Tribunal*` identifiers remain anywhere.
- **Dangling references.** A `git grep` of `tribunal-panel`, `TribunalState`, `getRoundJudge`, `tribunal-conductor`, `TRIBUNAL_ROSTER_PROPOSAL_TAG` and `COMMAND_CENTER_TRIBUNAL_REQUEST_TAG`, plus `'tribunal'` as a string literal, over ts/html/json/mjs/js/yml shows only skill-slug references. These are legitimate and cover harness-sync, skill specs, content-manifest and docs.
- **RPC removal.** `rpc.types.ts`, `rpc-tasks.types.ts`, `host-source-registry.baseline.ts`, `tasks-rpc.handlers.ts`, `tasks-rpc.schema.ts` and the handler spec changed consistently. `roundJudgeFile()` and the artifact reader are kept.
- **Preset removal.** `BUILTIN_HARNESS_PRESETS` is `[]`. The only consumer, `harness-config-store.service.ts:292`, iterates it, so an empty list is safe.
- **Stored CommandCenterRunManifest records.** `command-center-records.ts` and `tab-manager.service.ts` are unmodified. The chat-state tests for the records remain.
- **Mirror parity.** `cmp` is identical for all four changed skill files and their plugin copies. This does not cover the defects above, which are present in both copies.
- **Skill text against item 6.** `vendor-panel.md` section 0 accepts plain-text pins with duplicates allowed, forbids silent substitution, and requires confirmation of the panel and paid call count before `ptah_agent_spawn`. SKILL.md preflight and relay.md agree. Only crucible.md lags (defect 2).
- **Webview route and surface union.** `app.routes.ts`, `webview-surface.types.ts` and the lazy-view token no longer name `tribunal`. The routing spec was updated.

## Five logic questions (short)

1. Silent failure: a stale `initialView` on the renderer side degrades to chat with a warning. No silent loss found.
2. Unexpected user action: an agent following crucible.md reads "first lane executes, last judges" and infers roles, contradicting the new rule (defect 2).
3. Wrong-answer input: the `?` corruption makes the Relay instruction unreadable (defect 1).
4. Dependency failure: not applicable to this removal.
5. Missing: crucible.md was not in the diff at all.

## Verdict

REVISE. Fix defects 1 and 2 in both skill copies, then re-run `cmp`. No code-level blocking issues.

## Re-review after revise round 1 (orchestrator, anthropic)

- Defect 1 (SKILL.md:52-54 lost glyphs): FIXED — `—` and `→` restored in both copies; `cmp` identical.
- Defect 2 (crucible.md UI role tokens / old anchor / lane-order rule): FIXED — line 51 uses plain-text
  role pins and links `vendor-panel.md#0-explicit-panel-from-the-user` (heading at vendor-panel.md:15);
  no "UI role", "UI framing" or old anchor remains in references/. Mirror identical.
- Minor note (readRoundJudge kept): accepted per user decision 3 (keep the artifact reader).
- Verdict after round 1: APPROVED.

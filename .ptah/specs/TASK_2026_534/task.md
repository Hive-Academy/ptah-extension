---
status: in_progress
type: bugfix
title: 'Providers settings: fix runtime regressions and dead controls from PR #575'
---

# TASK_2026_534 — Hotfix for PR #575 (TASK_2026_523)

Scope is correctness only. The visual redesign is a separate task — do not
restyle, do not restructure the page. Worktree:
`D:\projects\ptah-extension\.claude-worktrees\providers-runtime-fix`
(branch `fix/providers-runtime-regressions`).

Old code for comparison: `git show 7ecdefa45^1:<path>`.

## R1 Runtime regressions (must fix)

1. **Claude API "Use for main agent" is always rejected.**
   `libs/frontend/core/src/lib/services/providers-settings-state.service.ts`
   `activateConnection` (~:485-496) and `connectProvider` (~:460-475) send
   `anthropicProviderId: 'anthropic'` / `'claude-cli'`. `AuthSettingsSchema`
   (`libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.schema.ts:49-54`)
   only accepts registry ids; `'anthropic'` is virtual
   (`libs/shared/src/lib/providers/provider-registry.ts:502`). Fix: for
   `authMethod` `apiKey` and `claudeCli` do not send `anthropicProviderId`
   (old UI never did).
2. **Activating Claude (Subscription) or Claude API pins main-agent tiers.**
   Tier writes with `scope:'mainAgent'` set
   `process.env.ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`
   (`provider-models.service.ts:547-551`). Fix: no `mainAgent` tier writes for
   `claude-cli` / `anthropic` (native Anthropic auth).
3. **Third-party activation overwrites the user's main-agent tiers.** Old flow
   filled only unset tiers (`autoMapProviderTiers`, invoked by `auth:saveSettings`
   at `auth-rpc.handlers.ts:~999`). Fix: do not copy tiers over existing
   mainAgent tiers; rely on the backend auto-map (verify it only fills unset
   tiers) or write only tiers that are unset.
4. **Connecting/managing a provider changes CLI sub-agent tiers.** The wizard
   writes `provider.<id>.cliAgent.modelTier.*` on connect; `ptah-cli-registry.ts:1484`
   reads it for every CLI agent on that provider without its own mapping. Fix:
   connecting a provider must not write `cliAgent` tiers unless the user
   explicitly edits CLI-agent tiers.

For each fix: trace the write to its runtime reader and confirm the result
(key, scope, value, env side effects). Record the trace in the report.

## R2 Controls that do nothing or block (must fix)

5. Activation / Save gating requires `lastSuccessfulProbeAt`, which
   `auth:getEffectiveRoute` always returns `null` (`auth-rpc.handlers.ts:543`,
   by design). Consequences: `activeProviderId` is always null
   (`providers-settings-state.service.ts:~224-249`); background-model Save for
   "Follow main agent" is blocked (`provider-consumer-assignments.component.ts:~636-679`);
   providers with status `skipped` (local: Ollama, LM Studio) or `unknown` can
   never be activated. Fix: derive the active provider from the effective route
   (`driverProviderId` / authMethod), and treat `skipped`/`unknown` as
   activatable with a note. Do not invent probe data.
6. `existingCredentialPresent` is never bound by the parent
   (`providers-settings.component.ts:~256-262`), so every Manage/Edit forces key
   re-entry. Bind it from the API-key status.
7. Agent Orchestration (`libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts`):
   - "Manage provider, model and credentials in Providers" does nothing while on
     Settings (`settings.component.ts:120` reads the pending tab only in
     `ngOnInit`). Make Settings react to `pendingSettingsTab` (effect) and consume it.
   - Codex auto-approve button (`:~289`) sends `codexAutoApprove`, which the
     backend ignores. Remove it.
   - Copilot auto-approve is a blind "Toggle" button. Make it a daisyUI
     `toggle` bound to the saved `copilotAutoApprove` value (as before the cut).
   - The CLI row chevron expands nothing (`:~229-237`). Remove the chevron and
     click handler.
   - The empty "Ptah CLI Agents" `<ng-content>` section (`:~320`) — remove it.
   - The grip icon with no drag support — remove the icon (arrows stay).
8. Deep links: `requestedProviderId` must open the setup wizard for that provider
   (`providers-settings.component.ts:~214`).
9. Remove the duplicate "Sign in to X / Check X sign-in" button row rendered
   between connection cards (`providers-settings.component.ts:~172-177`) — the
   card already has these actions.
10. "Model has not been resolved." for the default route is wrong wording; the SDK
    uses `default`. Show "Default model (chosen by Claude)".

## R3 CLI model lists (must fix)

11. `ptah-cli-config.component.ts` delegated pickers call `provider:listModels`
    with ids `cursor|antigravity|opencode|pi` (not registry ids → error + Sentry
    event per open). Use `agent:listCliModels` for delegated CLI models, as the
    old UI did (`git show 7ecdefa45^1:libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts`).
12. Reasoning effort is free text (`ptah-cli-config.component.ts:~96`); Pi passes
    it raw to `--thinking`. Replace with a select of the values the runtime
    accepts (`agent-spawn-environment.service.ts:85-98` mapEffortToCli; check Pi).

## Verification
- Update/add specs for every fix (jest). Run, scoped:
  `npx nx run-many -t typecheck,test,lint -p chat core rpc-handlers` (add a
  project only if you changed it). Tail output only.
- Do not commit. Write `.ptah/specs/TASK_2026_534/fix-report.md`: per item — change,
  file:line, write→reader trace (R1), test name, and anything not done.

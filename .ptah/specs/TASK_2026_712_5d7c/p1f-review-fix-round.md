# P1-F review fix round — finding 1 (Serious)

Finding: the CLI matrix maps the Grok and Antigravity effort rows to `grokReasoningEffort` /
`antigravityReasoningEffort` (`libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts:217,235`),
but the commit service had no operation for either key, so a patch with only that field made zero
writes, and the refresh projection dropped both, so stored values showed as default.

The fix follows commit `52d53237a`, which made the same change for `claudeModel` / `claudeReasoningEffort`.

## Changes

- `libs/frontend/core/src/lib/services/providers-commit.service.ts:161-162` — added
  `'grokReasoningEffort'` and `'antigravityReasoningEffort'` to the `agent:setConfig` /
  `agent:getConfig` operation field list in `operations()`.
- `libs/frontend/core/src/lib/services/providers-settings-state.service.ts:784-785` —
  `refreshOrchestration()` now projects `grokReasoningEffort` and `antigravityReasoningEffort`
  from `agent:getConfig`.
- `libs/frontend/core/src/lib/services/providers-settings.types.ts:74-75` — no edit needed:
  `ProvidersOrchestrationField` already lists both keys, so they are already in
  `ProvidersSettingsPatch.orchestration` and in `ProvidersOrchestration`. The shared RPC types
  carry both as optional strings on params and result (`libs/shared/src/lib/types/rpc/rpc-agents.types.ts:265,267,475,477`).

## Tests added

- `providers-commit.service.spec.ts:816` — typed `effortPatch(field, value)` helper. It builds a
  one-field patch without computed-key widening.
- `providers-commit.service.spec.ts:829` (`it.each`, 4 cases) — a patch with only
  `grokReasoningEffort` (`'high'` and `''`) or only `antigravityReasoningEffort` (`'medium'` and
  `''`) produces exactly one `agent:setConfig` call (`[field]: value`). The test also checks
  that an `agent:getConfig` read-back happened and that the commit reports
  `saved: ['agentOrchestration.<field>']`. An empty value means inherit/default.
- `providers-commit.service.spec.ts:859` (`it.each`, 4 cases) — the field is read back as a
  different value or as `undefined` (a host without the field), so the commit reports
  `failed` with `unsaved: ['agentOrchestration.<field>']`.
- `providers-settings-state.service.spec.ts:2043` — `refreshOrchestration()` carries a stored
  `grokReasoningEffort: 'high'` and `antigravityReasoningEffort: ''` into `orchestration().data`.
  The existing `toEqual` projection test at ~2010 still holds: its fixture has neither key, so
  the projected `undefined` values are ignored by `toEqual`.

## Write-path trace

1. CLI matrix row (`cli-matrix-rows.ts:217/235`) emits the patch
   `{ orchestration: { grokReasoningEffort | antigravityReasoningEffort } }`.
2. `ProvidersCommitService.operations(patch)` loops over the orchestration field list
   (now with both keys). When `patch.orchestration[field] !== undefined`, it pushes one operation:
   `fields: ['agentOrchestration.<field>']`.
3. `write` calls `agent:setConfig { [field]: value }`, which the backend routes via
   `platform-core/src/file-settings-keys.ts` (Batch 34b).
4. `readBack` calls `agent:getConfig` and compares `result[field]` with `value` via `sameSetting`.
   A match marks the field saved; a mismatch or missing value marks it unsaved.
5. Refresh: `ProvidersSettingsStateService.refreshOrchestration()` projects `config.<field>` into
   `orchestration().data`, so the matrix shows the stored value instead of the default.

## Verification

- `ptah_get_diagnostics` (errors) on the 4 changed files: no diagnostics in the requested
  files. The tool also listed errors in sibling spec files (`auth-state.service.spec.ts`,
  `autopilot-state.service.spec.ts`, `effort-state.service.spec.ts`,
  `electron-layout.service.spec.ts`). I did not touch those files, and the errors are
  unrelated to this change.
- No jest, nx or tsc run: forbidden by the round's rules. The orchestrator runs the scoped checks
  (`npx nx test core --parallel=1` or jest on the two changed specs with `--maxWorkers=2`).

## Decisions

- Typed `effortPatch` helper instead of `{ [field]: value }` in the patch argument. The
  alternative was a computed key, which widens to an index signature and is not reliably
  assignable to `ProvidersSettingsPatch.orchestration`. The evidence is that the patch type is a
  `Pick` of named optional fields. The choice is reversible.

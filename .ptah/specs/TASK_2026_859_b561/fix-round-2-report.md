# Fix Round 2 Report

Executor: kimi code lane (source + CLI/component specs). The lane hit a Kimi API rate limit (429)
before it wrote this report; the orchestrator wrote the report and the two mapper specs
(bounded correction, agent-lanes §6) after reading the diff.

## Item 1 — Install guard (re-review finding 1 PARTIAL)

- `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts:610-613`:
  `confirmInstall` takes `result.config` only when `result.ok && result.installable`; otherwise returns
  before any RPC. Target logic unchanged (R8).
- Test: component spec "blocks direct confirmInstall when required inputs are unresolved".

## Item 2 — Supplied / undeclared placeholder values masked (Serious)

- `libs/shared/src/lib/types/mcp-registry-config.mapper.ts:163-194`: a placeholder with no declared
  value is a required input with `isSecret: true` when it has no `variables` metadata
  (`forceSecret`), and any user-supplied placeholder value is written to `config` but shown as
  `••••••` in `preview`.
- Test (orchestrator): mapper spec "treats an undeclared URL placeholder as secret and masks it in
  preview".

## Item 3 — Parent-qualified nested keys (Serious)

- `mcp-registry-config.mapper.ts:106-121, 141-145, 204-229, 243-255, 264-280, 311-320`: nested keys are
  `packageArgument:<i>:<var>`, `runtimeArgument:<i>:<var>`, `header:<headerName>:<var>`,
  `url:<var>`; direct values stay `env:<name>` / `header:<name>` / `argument:<name>`.
- Tests: existing argument/header placeholder specs updated to the new keys; orchestrator added
  "keys same-named argument variables per argument" (two `{value}` args → two inputs, values not
  cross-written, neither shown in preview).

## Item 4 — CLI --input matching (Moderate)

- `apps/ptah-cli/src/cli/commands/mcp.ts:256-278`: `--input` accepts a full key or a unique bare name;
  ambiguous bare name → error listing qualified keys; unknown name/key → error naming it. Values are
  never printed.
- Tests: CLI spec "accepts qualified keys…", "rejects an ambiguous bare input name…", "rejects an
  unknown input name without printing its value".

## Modified files

- apps/ptah-cli/src/cli/commands/mcp.ts, mcp.spec.ts
- libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts, .spec.ts
- libs/shared/src/lib/types/mcp-registry-config.mapper.ts, .spec.ts

## Known limits

- Direct argument keys stay `argument:<name>`; two direct arguments with the same name/valueHint
  would share a key (not in the re-review scope).

## Verification

No local checks (D11). CI is the gate.

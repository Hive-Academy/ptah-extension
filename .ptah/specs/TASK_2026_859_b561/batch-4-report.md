# Batch 4 Report — CLI install path via the shared mapper

## Status

IMPLEMENTATION COMPLETE. VERIFICATION INCOMPLETE because the machine-wide verification queue did not start the command during this lane.

## Completed work

- Replaced the CLI `version_detail` guard and duplicate `generateConfig` function with `registryEntryToInstallConfig` from `@ptah-extension/shared`.
- Added `<code>: <message>` errors for `ok: false` mapper results.
- Added required-input-name errors for `installable: false` mapper results.
- Added `requiredInputs` as a string-name array to both `mcp.installed` notification paths.
- Updated the npm fixture to the 2025-12-11 `packages` shape and its expected versioned package argument.
- Added tests for a coded mapper error, required secret names without values, and unresolved URL input names without choices or values.

## Evidence

- `apps/ptah-cli/src/cli/commands/mcp.ts:217-232` checks the detail result, calls the shared mapper, throws coded errors, and rejects non-installable results with names only.
- `apps/ptah-cli/src/cli/commands/mcp.ts:234-277` includes `requiredInputs` in idempotent and successful `mcp.installed` notifications.
- The old `generateConfig` function and its header comment are deleted.
- `apps/ptah-cli/src/cli/commands/mcp.spec.ts:137-153` uses the new `packages` fixture shape.
- `apps/ptah-cli/src/cli/commands/mcp.spec.ts:306-458` covers coded errors, secret names without values, and non-installable URL inputs.
- No install-scope code or `mcp-install.service.ts` file was changed.

## R5 and D4 handling

- D4: the CLI uses the Batch 1 shared mapper. The duplicate CLI mapping logic is removed.
- R5: unresolved secret values stay absent from the install config. Notifications contain required input names only.
- The secret test asserts that `config.env` is absent and `requiredInputs` equals `['AI_2KW_API_KEY']`.
- The non-installable test asserts that the URL choice value `api.example.com` is absent from the error payload.

## Files created or modified

- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/apps/ptah-cli/src/cli/commands/mcp.ts` — modified.
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/apps/ptah-cli/src/cli/commands/mcp.spec.ts` — modified.
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/.ptah/specs/TASK_2026_859_b561/batch-4-report.md` — created.

## Verification

Command: `npm run verify -- -p ptah-cli 2>&1 | tail -40`

- First attempt `bmm8n594b`: waited in the queue and was killed at its background time limit before producing output.
- Second attempt `bxg0oxj6m`: restarted with a 7,200,000 ms background limit. It remained queued behind the machine-wide lock and memory threshold when this report was written.
- Final output tail: unavailable. Both output files remained empty because `tail` had no completed command output to write.
- No verification pass or failure is claimed.

Ptah diagnostics: unavailable after three attempts. The TypeScript check did not finish within the tool's 45-second limit. This is not a substitute for the required scoped verification.

## Decisions

- Use the Batch 1 mapper without changes. Evidence: D4 and the mapper contract in `mcp-registry-config.mapper.ts`. Reversible: yes.
- Add `requiredInputs` to successful and idempotent `mcp.installed` payloads as string names. Evidence: Task 4.1 requires names in the existing notification payload. Reversible: yes.
- Keep unresolved secrets installable and omit their values from the config. Evidence: D8, R5, and the mapper contract. Reversible: yes.
- Reject non-installable mapper results before the install RPC. Evidence: Task 4.1 and R4. Reversible: yes.
- Restart the killed verification once with a longer background limit. Evidence: the first attempt produced no output and had not run the checks. Reversible: yes.

## Unmet requirement

The required `ptah-cli` lint, test, and typecheck results are not available. The team-leader must obtain a completed scoped verification before accepting or committing Batch 4.

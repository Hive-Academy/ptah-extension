## Backend implementation — `TASK_2026_719_4f64`, P2 fix 3 (finding 3 + style note)

**Tasks completed**: A (finding 3, registry listing fails closed when it has no structure). B (style note) was checked and not applied. The reason is under Plan deviations.

**Files**:

- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-auth-settings-scan.ts — `registrySubkeys` (lines 135-168) now validates the listing's structure before any missing subkey can count as absence.
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-auth-settings-scan.spec.ts — 7 new cases (lines 305-337).
- NOT MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-named-account-persistence.ts — see Plan deviations.

### A. Change (claude-auth-settings-scan.ts:146-167)

`registrySubkeys` is shared by the Policies query and the SOFTWARE parent fallback (`hiveAbsent`, unchanged). It now returns `null`, which the scan treats as malformed and refuses with `unsupported-source`, in these cases:
- a four-space value line comes before the queried-key header (value-only output);
- the output has neither the normalized queried-key header nor any subkey line. This covers empty and whitespace-only output.

The existing rules still apply: overflow, any unrecognised line, a line under another key, and a nested path all refuse.

### Tests added (spec:305-337)

- `malformed: %s exit-0 Policies listing refuses` × {empty, whitespace-only, value-only (four-space values, no header)}. Each returns REFUSED, and the scan stops after the first query.
- `malformed: %s exit-0 parent fallback listing refuses` × the same three inputs. Policies exits 1, then the SOFTWARE listing is structureless, and the result is REFUSED.
- `a header-only listing (key with values, no subkeys) is well formed` is a positive control. It shows that real header + values output still passes.

All existing cases still pass unchanged. That includes the header-free subkey-only fixtures and the "header + value + subkey" case.

## Decisions

- **The header is not strictly required in every listing.** The review says "require the normalized queried-key header in each successful listing", but real `reg.exe` output does not always have one. implementation-plan.md:386-408 records verified output: `reg query HKLM\SOFTWARE\Policies` exits 0 and prints subkey lines only, with no header. The header is printed only when the key has values. Requiring the header would refuse every real Windows machine, and the existing clean-path fixtures would fail.
  - Options: (a) require the header, which breaks real output; (b) require the header or at least one subkey line of the queried key, and accept value lines only after the header.
  - Chosen: (b). It rejects every case in the finding (empty, whitespace-only, headerless value-only) and still accepts real output.
  - A key with no values and no subkeys now refuses (fail closed). That is acceptable: HKLM/HKCU `SOFTWARE\Policies` and `SOFTWARE` are never empty in practice.
  - Reversible: yes, it is local to one function.

**Stack observed**: tsyringe DI with explicit `@inject` (claude-named-account-persistence.ts:40-54). The scan is pure functions plus an injected fake `queryRegistry`/fs in the specs (spec:83-109). No real reg.exe was run.

**Verification**:
- `npx eslint claude-auth-settings-scan.ts claude-auth-settings-scan.spec.ts`: exit 0, no output (0 errors, 0 warnings).
- `npx jest -c libs/backend/auth-providers/jest.config.ts …/claude-auth-settings-scan.spec.ts …/claude-named-account-persistence.spec.ts --maxWorkers=2`: Test Suites 2 passed, Tests 83 passed.
- `npx tsc --noEmit -p libs/backend/auth-providers/tsconfig.lib.json`: no `error TS` lines. The same command with tsconfig.spec.json also had no errors in the scan files.
- `npm run verify` was not run, per the brief.

**Plan deviations**:
- **B was not applied.** auth-providers already depends on `@ptah-extension/agent-sdk`: this very file imports `SDK_TOKENS`, `SessionMetadata` and `SessionMetadataStore` from it, so the dependency edge is allowed. The blocker is that `NamedAccountPersistencePort` (libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:559) is not exported from the `@ptah-extension/agent-sdk` barrel. It is used only inside agent-sdk (sdk-query-runner.service.ts:90), and the session-lifecycle sub-barrel is marked internal. Two ways to add the `implements` clause exist, and both are out of bounds:
  - exporting it from the agent-sdk barrel needs an agent-sdk edit, which this fix may not touch;
  - a deep relative import breaks the barrel-only import rule.
- Recommendation for the owner of agent-sdk: add `export type { NamedAccountPersistencePort }` to the agent-sdk public index, then add `implements NamedAccountPersistencePort` at claude-named-account-persistence.ts:41. The class comment at lines 32-39 already describes the port by name.

**Out-of-scope observations**: none.

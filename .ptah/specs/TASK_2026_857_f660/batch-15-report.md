# Batch 15 report

## Work completed

- `routeDecideResponse` reads the trimmed MCP caller session ID and resolves its tab ID through `getSessionTabId`, falling back to the caller ID. It passes that key privately to `handleRouteToolCall`.
- The handler forwards optional context to `RouteNamespace.decide`; the namespace forwards it to the existing `RouteDecideService.decide` API. Calls without a key retain the existing one-argument handler call. Batch 14's service cache lookup handles hits and misses; no routing rule or gate-0.1 text changed.
- Exported `buildRouteCandidateSource` through the lm-tools public barrel, as Component 14 requires.
- Added handler specs through the real namespace and a session-aware service stub: matching key returns the reused result, different key returns a fresh result, missing key keeps fresh behavior, and neither key appears in tool output. Batch 14's `route-decide.preflight.spec.ts` covers the real cache's zero-dispatch hit and one-dispatch miss behavior.
- Scoped `ptah_get_diagnostics` after edits: TypeScript compiler, 0 errors and 0 warnings, clean coverage.

## Files touched

- `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/route-namespace.builder.ts`
- `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/route-tool-handlers.ts`
- `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/route-tool-handlers.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
- `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/vscode-lm-tools/src/index.ts`
- `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/.ptah/specs/TASK_2026_857_f660/batch-15-report.md`

## Verification

Command: `npm run verify -- -p @ptah-extension/vscode-lm-tools 2>&1 | tail -40` (PowerShell invoked Git's `tail.exe -40`). Exact output tail:

```text
> @ptah-extension/source@0.0.0 verify
> node scripts/verify.mjs -p @ptah-extension/vscode-lm-tools

[verify 2026-10-30T21:32:57.219Z] waiting for memory: 6.8 GB free, a second run needs 8.0 GB (held by pid 42856 [verify lint,test,typecheck (cli-agent-runtime,codex-runtime,cli-engine,ptah-electron,degradation-audit)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-30T21:31:00.516Z)
[verify 2026-10-30T21:32:59.237Z] waiting for memory: 6.7 GB free, a second run needs 8.0 GB (held by pid 42856 [verify lint,test,typecheck (cli-agent-runtime,codex-runtime,cli-engine,ptah-electron,degradation-audit)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-30T21:31:00.516Z)
[verify 2026-10-30T21:33:00.250Z] waiting for memory: 6.6 GB free, a second run needs 8.0 GB (held by pid 42856 [verify lint,test,typecheck (cli-agent-runtime,codex-runtime,cli-engine,ptah-electron,degradation-audit)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-30T21:31:00.516Z)
[verify 2026-10-30T21:33:01.257Z] waiting for memory: 6.5 GB free, a second run needs 8.0 GB (held by pid 42856 [verify lint,test,typecheck (cli-agent-runtime,codex-runtime,cli-engine,ptah-electron,degradation-audit)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-30T21:31:00.516Z)
[verify 2026-10-30T21:33:02.265Z] lock slot 1 acquired after 5s: verify lint,test,typecheck (@ptah-extension/vscode-lm-tools)

 NX   3 tasks: 3 succeeded


Re-run with --output-style=static to inline logs.

  Run duration:      2m 35s
  Cache:             0/3 hit (0%)
  Critical path:     1m 59s (1 task)
  Recoverable time:  36.2s (23% of the run)

  Recommendations:
    - Increase parallelism to recover up to 36.2s ? https://nx.dev/docs/concepts/ci-concepts/parallelization-distribution?utm_source=nx-cli&utm_medium=cli&utm_campaign=performance-report&utm_content=parallelization.
    - Drastically reduce your run duration by sharing a cache across your team and CI ? https://cloud.nx.app/connect/Bb0EIsD8YG.
[verify 2026-10-30T21:35:43.124Z] lock released after 160.9s, exit code 0
```

Command: `npm run verify -- -t typecheck -p ptah-electron 2>&1 | tail -20` (PowerShell invoked Git's `tail.exe -20`). Exact output tail:

```text
> @ptah-extension/source@0.0.0 verify
> node scripts/verify.mjs -t typecheck -p ptah-electron

[verify 2026-10-30T21:35:50.505Z] lock slot 1 acquired after 0s: verify typecheck (ptah-electron)

 NX   1 task: 1 succeeded


Re-run with --output-style=static to inline logs.

  Run duration:      34.8s
  Cache:             0/1 hit (0%)
  Critical path:     34.6s (1 task)
  Recoverable time:  <1ms

  Recommendations:
    - Drastically reduce your run duration by sharing a cache across your team and CI ? https://cloud.nx.app/connect/hKGfLt4qsx.
    - Speed up or split the longest tasks on the critical path:
        ptah-electron:typecheck    34.6s
[verify 2026-10-30T21:36:35.854Z] lock released after 45.3s, exit code 0
```

## Risks

- **New Nx edge:** Ptah dependency graph already identifies `route-namespace.builder.ts` → `libs/backend/lane-routing/src/index.ts`; no new library dependency was introduced.
- **Cache correctness:** The handler supplies only the session key. Batch 14's service and cache still decide whether revision, continuity, setting, and model fingerprint permit reuse; misses fall through to normal pre-flight.
- **Privacy:** The session key is context, never a tool argument or result field. Specs assert it is absent from both matching and different-key outputs. No logging of the key was added.
- **Gate-0.1:** The service consults reuse only inside its parsed `pre-flight` branch (`route-decide.service.ts:123-145`); gate behavior remains skill-driven.
- **Large dispatcher:** Only the route delegation function changed.
- **Skill availability:** No invokable skill mechanism was listed for this coding lane; repository instructions and available Ptah tools were used.

## Decisions

| Decision                                                          | Options                                                                 | Evidence                                                                                                                | Reversible |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------- |
| Use mapped tab ID, falling back to caller ID, as the cache key.   | Mapped tab ID; raw caller ID.                                           | Component 14 lines 824-828 and existing artifact publish path at `protocol-dispatcher.ts:2366-2378`.                    | Yes.       |
| Keep session context out of tool arguments and JSON output.       | Optional internal context; add a tool argument.                         | `RouteDecideArgsSchema` is the external boundary; `RouteDecideService.decide` already accepts context at lines 114-126. | Yes.       |
| Use a session-aware service stub in handler specs.                | Stub at namespace boundary; duplicate Batch 14 cache integration tests. | The handler needs forwarding coverage; `route-decide.preflight.spec.ts` already verifies cache dispatch counts.         | Yes.       |
| Export only `buildRouteCandidateSource` from the lm-tools barrel. | Export builder; export broader namespace API.                           | Component 14 line 829 requests only this export for Component 16.                                                       | Yes.       |

## Hand-off for Batch 18

- The host routing coordinator must store its validated pre-flight result under the same resolved key: `getSessionTabId(callerSessionId) ?? callerSessionId`, with a trimmed caller ID. A different key is an intentional cache miss.
- Keep cache revision confirmation and invalidation in Batch 13's `PreflightReuseCache`; the MCP path only forwards identity. Batch 14's service performs fingerprint and continuity checks on a skill pre-flight call.
- A call without an MCP caller session ID supplies no context and follows the ordinary pre-flight path.

# Backend regression report

## Suite decisions and changes

| Suite | Failing tests | Decision | Change |
| --- | --- | --- | --- |
| `ptah-cli-rpc.handlers.spec.ts` | Four TypeScript fixture errors at lines 267, 555, 575, 593 | (a) Registry summaries now require a manifest. | Added a small local, typed manifest to `makeSummary`. The runtime test helper is not exposed through a public test entry. |
| `agent-rpc.handlers.spec.ts` | Resume decisions, account selection, and four `agent:continue` tests | (a) Resume and continue now delegate through services, and continue validates agent IDs. | Registered coordinator/resume doubles in the direct-constructor harness. Used a valid UUID in the continue tests. Kept account-refusal assertions. |
| `agent-rpc.handlers.resume-parent-session.spec.ts` | Parent threading, resume gate, validation, and no-filesystem-gate tests | (a) Resume now uses `AgentLaneResumeService`. | Registered a resume-service double that delegates to the existing manager mock, preserving the parent and resume assertions. |
| `protocol-dispatcher.spec.ts` | Two `ptah_agent_message` delegation assertions | (a) Message API gained `allowPartialTurnLoss`. | Expected the fourth, omitted argument. |
| `tool-description.builder.spec.ts` | Delivery enum assertion | (a) Approved delivery modes include `now`. | Expected `queue`, `now`, `steer`; did not change byte-budget or roster guards. |
| `agent-tool.dispatcher.spec.ts` | Two message delegation assertions | (a) Message API gained `allowPartialTurnLoss`. | Expected the fourth, omitted argument. |
| `stdio-mcp-server.service.spec.ts` | Message delegation assertion | (a) Message API gained `allowPartialTurnLoss`. | Expected the fourth, omitted argument. |

No production defect was found in these failures. The account-refusal and parent-session guard assertions remain in place.

## Verification

- Required command `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/vscode-lm-tools -- --output-style=static` acquired a slot and confirmed **for 2 projects**.
- Lint and typecheck: **passed for 2 projects**.
- `vscode-lm-tools`: **100 suites passed, 3,342 tests passed**.
- `rpc-handlers` at that run: **221 suites passed, 14 failed; 6,149 tests passed, 40 failed, 8 skipped**. Thirteen failing suites were the known machine failures listed in `verify-backend-1-5.md`; the remaining suite was `agent-rpc.handlers.spec.ts` with four invalid `a-1` fixture IDs.
- After changing those IDs, direct focused Jest for `agent-rpc.handlers.spec.ts`: **1 suite passed, 78 tests passed**. The other six requested suites passed in the full run. A second full verify was not run.
- Ptah diagnostics timed out after 45 seconds and reported the edited files unchecked. The required command's typecheck passed before the final fixture-ID edit; the focused Jest run passed after it.

## Decisions

- Keep manifest fixture local. Options: export the runtime helper from a production index, deep-import it, or keep a local fixture. The helper has no public test entry; the local fixture follows the public-import rule. Reversible.
- Keep direct-constructor harnesses and register service doubles. Options: resolve a real runtime container or supply the newly delegated services. Existing tests assert manager calls and the service implementation delegates to that manager; doubles preserve their purpose. Reversible.

## Limitations

- No skill-loading tool was available in this lane. No git command or frontend change was made.

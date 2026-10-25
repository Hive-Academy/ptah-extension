Review family: codex (OpenAI) reviewing Claude (Anthropic) implementers

# P1-E code style review — TASK_2026_712_5d7c

Score: **7/10**. Verdict: **APPROVED WITH FIXES** for the inspected excerpts only; complete phase approval remains withheld.

## Scope

Companion architectural/style observations from the logic-review lane. This does not substitute for a full code-style-reviewer pass: that specialist should own the finding below. No style, naming or formatting issue is duplicated in the logic findings.

Current source and task reports were inspected; no Git baseline comparison, formatter, lint or test command was run. Full coverage of every batch file, all import boundaries and file-size rules was not achieved. The three batch-27a source files and selected runtime/RPC boundaries received the deepest inspection. Passing lint/typecheck statements in D30/D32 are reported prior evidence, not checks performed here.

## Numbered findings

### 1. Moderate — account lookup dependency is resolved inside the handler

- Location: `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1520` and `:1524`.
- Scenario: resume with a supplied account selection depends on ProviderAccountService, but that dependency is hidden behind runtimeContainer.isRegistered/resolve rather than represented in constructor injection. A manually constructed handler or a host with incomplete registration can appear correctly constructed until that branch returns unavailable-storage.
- Impact: composition requirements are harder to inspect and direct-construction tests can omit a dependency the production path uses. The fail-closed fallback is correct; this finding does not claim unsafe ambient fallback.
- Suggested fix: inject an optional narrow lookup port in the constructor and register it in the composition layer, updating direct-construction mocks. If lazy resolution is necessary, inject an explicitly typed provider/factory from registration rather than the general container.
- Disposition: **known D32 exception**, not a newly discovered regression or an independent release blocker. D32 explains the choice as preserving seven direct-construction specs; test compatibility is a reason to schedule the cleanup, not proof that the dependency is declared. Route follow-up to code-style-reviewer.

## Examined conventions

- ProviderAccountRpcHandlers uses constructor injection and a narrow service Pick (`provider-account-rpc.handlers.ts:62`, `:147`); singleton registration is explicit (`register-shared-rpc-handlers.ts:104`). No second handler instance was established.
- Provider account schemas use strict objects and a mapped registry contract (`provider-account-rpc.schema.ts:130`). Inspected new schema/handler/ledger/spawn-schema code did not establish a need for any or double casts. This is not a whole-diff type-precision certification.
- MCP account parsing reuses the public shared schemas entry point (`agent-spawn-args.schema.ts:8`, `agent-namespace.builder.ts:190`), and the roster uses SYSTEM_CLI_TYPES (`agent-spawn-args.schema.ts:77`).
- The handler imports vscode-core through its public barrel (`provider-account-rpc.handlers.ts:36`), which is the existing handler-layer convention. No finding of a newly introduced vscode-core import in a neutral library is made without a diff and full dependency review.
- ClaudeLedgerSource depends on the account resource-context type through the public auth-providers-tokens barrel (`claude-ledger.source.ts:3`).
- The agent handler is large (configuration writer is at `agent-rpc.handlers.ts:1753`), but size alone is not a supported new regression and no arbitrary line-count finding is raised.

## Decisions and score

D32 is documented as an acknowledged dependency-injection exception. Retaining it temporarily versus constructor/port injection are the available options; explicit injection is recommended and reversible. No source edit was made.

7/10 reflects substantive typed boundaries and conventional singleton registration in inspected code, with an acknowledged DI exception. An 8–10 score would need the exception resolved or explicitly accepted as a repository convention and complete import/file coverage. A 5–6 score is not justified by the limited style evidence: no pervasive pattern violation was established. The logic review's behavioural findings are scored separately.

## Verification and remaining work

No independent lint or compiler run; no visual review. Complete style certification still requires the exact diff, all changed files, per-library boundary checks, and a specialist review of file-size and DI conventions. Conditional approval here does not approve those unread files.


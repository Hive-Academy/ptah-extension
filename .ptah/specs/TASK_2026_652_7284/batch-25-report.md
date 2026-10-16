# Batch 25 report

## Changes

- `libs/backend/agent-generation/src/lib/services/analysis-freshness.service.ts:81-87`: log the caught error's name and message as strings alongside the analysis root. The logger's `warn(message, ...args)` signature accepts a structured argument; its serializer would render a nested `Error` as `{}`.
- `libs/backend/agent-generation/src/lib/services/content-generation.service.ts:620-629`: include the freshness failure's name and message in the existing warning while keeping the gathered-context fallback.
- `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:1074-1080`: include the analysis-reader failure's name and message in the existing warning.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:407-414`: warn with a fixed, content-free message when failed-launch reporting rejects.

All three existing degradation-audit suppression marker comments remain intact. No audit baseline was changed.

## Spec evidence

- `analysis-freshness.service.spec.ts:351-366`: asserts the warning contains `Error` and `I/O failure` as strings.
- `content-generation.service.spec.ts:1689-1705`: asserts the warning contains the freshness error name and message while generation uses gathered context.
- `enhanced-prompts.service.spec.ts:1354-1400`: asserts the warning contains the reader error name and message.
- `wizard-generation-rpc.handlers.spec.ts:963-984`: asserts the terminal warning after failed-launch reporting rejects. The checkpoint service itself logs and absorbs storage write errors, so the test uses a reporting failure to exercise this catch.

## Checks

- Prettier on all eight changed files: passed.
- `nx run-many -t typecheck,lint` for `@ptah-extension/agent-generation` and `@ptah-extension/rpc-handlers` with `--parallel=1`: passed; header confirmed 2 projects.
- Focused agent-generation Jest specs: 3 suites, 158 tests passed.
- Focused rpc-handlers Jest spec: 1 suite, 66 tests passed.
- `nx lint degradation-audit --parallel=1` (check mode): passed; 296 unsuppressed sites, matching baseline.

## Decisions

- Used structured string fields for error name and message rather than passing an `Error` nested in an object. `Logger.warn` accepts variadic arguments, and `formatLogArg` serializes plain objects with `JSON.stringify`; nested `Error` values lose their non-enumerable fields. This is reversible.

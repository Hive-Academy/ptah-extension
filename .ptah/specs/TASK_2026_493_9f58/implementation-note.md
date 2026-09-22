# TASK_2026_493_9f58 — implementation note

The declarative dashboard contract and the one MCP tool that emits a spec.
Backend and shared contract only. Nothing under `libs/frontend/**` or
`apps/ptah-extension-webview/**` was created or edited.

## Files changed

| Path                                                                                                       | Change                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/shared/src/mcp-apps-contracts/dashboard-catalog.ts`                                                  | NEW. Versions, the five component kinds, the action allowlist, the URL scheme allowlist, the text formats, `DASHBOARD_LIMITS`, `isAllowedDashboardUrl`. No zod. |
| `libs/shared/src/mcp-apps-contracts/dashboard-spec.types.ts`                                               | NEW. The published PLAIN types, with no zod import: envelope, the five components, data reference, action, rich text, series, table column/cell, list item. |
| `libs/shared/src/mcp-apps-contracts/dashboard-spec.schemas.ts`                                             | NEW. Every zod schema, each bound to its type with `satisfies z.ZodType<…>`; plus the tree measurements the envelope refinement needs.                    |
| `libs/shared/src/mcp-apps-contracts/dashboard-spec.validator.ts`                                           | NEW. `validateDashboardSpec(input, countUtf8Bytes)` — the one reusable boundary validator, plus the plain-text issue formatter.                    |
| `libs/shared/src/mcp-apps-contracts/dashboard-text-fallback.ts`                                            | NEW. `renderDashboardSpecText` (the mandatory text fallback) and `describeDashboardLimits`.                                                        |
| `libs/shared/src/mcp-apps-contracts/index.ts`                                                              | NEW. Public API of the `@ptah-extension/shared/mcp-apps-contracts` entry point.                                                                    |
| `libs/shared/src/mcp-apps-contracts/dashboard-budgets.spec.ts`                                             | NEW. One at-limit and one over-limit test per budget, plus the duplicate-id rejection. 18 tests.                                                   |
| `libs/shared/src/mcp-apps-contracts/dashboard-trust-boundary.spec.ts`                                      | NEW. One `describe` per trust-boundary control. 60 tests.                                                                                          |
| `libs/shared/src/mcp-apps-contracts/dashboard-spec.contract.spec.ts`                                       | NEW. Envelope, fail-closed, atomicity, data sources, tree measurements, text fallback. 33 tests.                                                   |
| `libs/shared/src/testing/fixtures/dashboard-spec.ts`                                                       | NEW. Fixtures shared by the contract specs and the backend spec, including `makeDashboardSpecOfExactBytes`.                                        |
| `libs/shared/src/testing/index.ts`                                                                         | MODIFIED. Exports the new fixtures from `@ptah-extension/shared/testing`.                                                                          |
| `libs/shared/src/index.ts`                                                                                 | MODIFIED. Exports the zod-free `dashboard-spec.types` from the main barrel, beside `provider-profile.types`.                                       |
| `libs/shared/src/lib/types/messages/message-constants.ts`                                                  | MODIFIED. Added `DASHBOARD_SPEC_PROPOSED: 'dashboard:spec-proposed'` beside `HARNESS_CONFIG_PROPOSED`.                                             |
| `libs/shared/src/lib/types/messages/payload-map.ts`                                                        | MODIFIED. Added `DashboardSpecProposedPayload` and its `'dashboard:spec-proposed'` entry in `MessagePayloadMap`.                                   |
| `libs/shared/package.json`                                                                                 | MODIFIED. Added the `./mcp-apps-contracts` export condition.                                                                                      |
| `tsconfig.base.json`                                                                                       | MODIFIED. Added the `@ptah-extension/shared/mcp-apps-contracts` path mapping.                                                                      |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/dashboard-namespace.builder.ts`    | NEW. `ptah.dashboard.proposeSpec` — validate (with `jsonUtf8Bytes`), then broadcast once, then render text. The first measurement point.           |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/dashboard-namespace.builder.spec.ts` | NEW. Ordering, atomicity, payload shape, the byte budget at the boundary. 14 tests.                                                               |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/dashboard-propose-spec.tool.ts`              | NEW. `ptah_dashboard_propose_spec`, with its input schema generated by `z.toJSONSchema`.                                                           |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/dashboard-propose-spec.tool.spec.ts`         | NEW. Schema-is-generated equality, `tools/list`, `tools/call` routing, `isError` on rejection. 13 tests.                                           |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`                      | MODIFIED. Tool added to the always-on `tools/list` set; one `tools/call` case.                                                                     |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`                                             | MODIFIED. `dashboard: DashboardNamespace` on `PtahAPI` (non-optional).                                                                            |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`                          | MODIFIED. Wires the namespace with a `webviewManager`-backed broadcast, mirroring the harness namespace.                                           |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/index.ts`                          | MODIFIED. Re-exports the new builder and its types.                                                                                               |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts`      | MODIFIED. `ptah.help('dashboard')` topic and the overview line.                                                                                   |

No RPC namespace was added, so `libs/shared/.../rpc.types.ts` and
`ALLOWED_METHOD_PREFIXES` in `libs/backend/vscode-core/src/messaging/rpc-handler.ts`
are untouched — see Decisions.

## Contract summary

The contract is in two halves, following `provider-profile.types.ts` /
`provider-profile.schemas.ts`: `dashboard-spec.types.ts` holds the published
plain types with **no zod import** and is exported from the main
`@ptah-extension/shared` barrel; `dashboard-spec.schemas.ts` holds the zod
schemas, binds each to its type with `satisfies z.ZodType<…>`, and is reached
through `@ptah-extension/shared/mcp-apps-contracts`. Decisions 10 explains why
that split is load-bearing rather than stylistic.

### Envelope — `DashboardSpecEnvelope` / `DashboardSpecEnvelopeSchema`

| Field           | Type                                                    | Notes                                                              |
| --------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| `schemaVersion` | `'dashboard-spec/1'`                                    | `z.enum` over `DASHBOARD_SUPPORTED_SCHEMA_VERSIONS`. Unknown ⇒ rejection. |
| `catalogVersion`| `'dashboard-catalog/1'`                                 | `z.enum` over `DASHBOARD_SUPPORTED_CATALOG_VERSIONS`. Versions independently, so a sixth component kind does not invalidate stored envelopes. |
| `specId`        | slug, `^[A-Za-z0-9][A-Za-z0-9._:-]*$`                   | Safe as a key, a DOM id fragment and a log field with no escaping. |
| `revision`      | positive integer                                        | Carried for the pinned-refresh work; this task does not interpret it. |
| `generatedAt`   | ISO 8601 with `Z` or an offset                          | `z.iso.datetime({ offset: true })`. A bare date is rejected.       |
| `title`         | `{ text, format?: 'plain' \| 'markdown' }`              | Required. The first line of the text fallback.                     |
| `description`   | same, optional                                          |                                                                    |
| `components`    | 1..200 `DashboardComponent`                             | Tree-wide count, depth and id uniqueness are envelope refinements. |

Every object in the contract is `.strict()`: an unknown key is a rejection that
names the path, never a silently dropped field.

### The five component kinds

Common to all: `id`, `title?`, `description?`, `actions?`, `children?`.

| Kind         | Payload                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------- |
| `stat`       | `value` (string or number), `unit?`, `delta?`                                              |
| `line-chart` | exactly one of `series: [{ name, points: [{x, y}] }]` or `data: { resultId, rowCount?, truncated? }`; `xLabel?`, `yLabel?` |
| `bar-chart`  | same as `line-chart`                                                                      |
| `table`      | `columns: [{ key, label, align? }]` (1..50) plus exactly one of `rows` (one cell per column; cells are string/number/boolean/null) or `data` |
| `list`       | `ordered?` plus exactly one of `items: [{ text, detail?, url? }]` or `data`                |

`children` is layout nesting and is what makes tree depth a real property while
keeping the catalog at exactly five kinds — see Decisions.

### Limits — all seven budgets are PROVISIONAL

| Limit                          | Value                 | Status                                                                                                  |
| ------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------- |
| Max components (tree-wide)     | 200                   | **Provisional.** TASK_2026_494 confirms.                                                                |
| Max tree depth                 | 8                     | **Provisional.** TASK_2026_494 confirms.                                                                |
| Max string length              | 2,000 characters      | **Provisional.** Applies to every string, ids included.                                                 |
| Max table rows                 | 1,000                 | **Provisional.** Also caps `list.items`.                                                                |
| Max table columns              | 50                    | **Provisional.** TASK_2026_494 confirms.                                                                |
| Max series points per chart    | 5,000                 | **Provisional.** Summed across a chart's series, not per series.                                        |
| Max total spec size            | 262,144 UTF-8 bytes   | **Provisional.** Measured by `jsonUtf8Bytes` on the value as it arrived.                                |
| Duplicate component id         | rejection, no number  | **Confirmed.** A rule, not a budget — there is nothing for a render test to measure.                    |
| Text-fallback table row cap    | 20                    | **Confirmed.** Fixed by `context.md` "Transport contract", not by rendering.                             |
| Actions per component; series per chart | 200 (`FINITE_ARRAY_MAX`) | **Provisional, and not a designed number.** The Budgets table sizes neither, but an unbounded array at a trust boundary is a defect, so both reuse `maxComponents` as a structural ceiling. `dashboard-spec.schemas.ts` says so at the constant and asks TASK_2026_494 to give each a real `DASHBOARD_LIMITS` entry if a render test produces one. |

Every number lives once, in `DASHBOARD_LIMITS` (`dashboard-catalog.ts`), and is
read from there by the schemas, the rejection messages, the tool description and
the tests. Confirming a budget in TASK_2026_494 is a one-line change in one file
and requires no test edits.

### Transport

- `MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED = 'dashboard:spec-proposed'`.
- `DashboardSpecProposedPayload = { spec: DashboardSpecEnvelope; sessionId?: string; toolCallId: string }`,
  registered at `'dashboard:spec-proposed'` in `MessagePayloadMap`.
- `sessionId` is optional because an anonymous MCP caller (a `tools/call` whose
  URL carried no `/session/{id}`) genuinely has none. The payload doc says a
  surface must read absence as "not mine", never as "the active session".
- Success result: `content: [{ type: 'text', text: <plain-text dashboard> }]`, no
  `isError`. Rejection: `isError: true` with the reason, and no push message.

## Trust boundary

The five controls from `research-report.md` Revision 6 entry 1, as
`context.md` "Trust boundary" numbers them.

| # | Control                    | Where it lives                                                                                                                   | Test that proves it                                                                                                                                                        |
| - | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | Action allowlist           | `DASHBOARD_ACTIONS` in `dashboard-catalog.ts`; `DashboardActionSchema.action = z.enum(DASHBOARD_ACTIONS)` in `dashboard-spec.schemas.ts` | `dashboard-trust-boundary.spec.ts` → `control 1 — action allowlist`: each allowlisted id accepted; `shell.exec`, `dashboard.delete`, a trailing-space and an upper-case variant rejected; an unknown action inside an otherwise valid spec rejects the WHOLE spec. |
| 2 | Zod validation, no `any`, no passthrough | every schema in `dashboard-spec.schemas.ts` is `.strict()`; `validateDashboardSpec` is the only `unknown` entry point            | `dashboard-trust-boundary.spec.ts` → `control 2`: a comment-stripped source scan of all six contract files finds no `: any`, no `as any`, no `z.any(`, no `z.unknown(`, no `.passthrough(`/`.loose(`/`.looseObject(`/`.catchall(`; behaviourally, an unknown key on a component and on the envelope is rejected with the path named, a nested object or array in `action.params` is rejected, a wrongly typed value is not coerced, and `null`/`undefined`/string/number/array/boolean inputs are rejected without throwing. |
| 3 | Output escaping            | the contract has no HTML-bearing field; rich text is `{ text, format?: 'plain' \| 'markdown' }`; `DASHBOARD_MARKDOWN_CHOKEPOINT = '@ptah-extension/markdown'` records the renderer's obligation | `dashboard-trust-boundary.spec.ts` → `control 3`: the source scan finds no `innerHTML`, `dangerously`, `bypassSecurityTrust` or `html:` field; `format` is exactly `['plain','markdown']` and is left `undefined` (not defaulted) when absent, so the safe branch is the default; `format: 'html'` and `'raw'` are rejected; `renderDashboardSpecText` passes `<img src=x onerror=alert(1)>` through verbatim, proving the fallback is not a second markdown/HTML path. |
| 4 | URL scheme allowlist       | `DASHBOARD_URL_SCHEME_ALLOWLIST` and `isAllowedDashboardUrl` in `dashboard-catalog.ts`; `DashboardUrlSchema` in `dashboard-spec.schemas.ts` | `dashboard-trust-boundary.spec.ts` → `control 4`: `https:` accepted (including upper-case scheme and a query/fragment); `javascript:`, a mixed-case `JaVaScRiPt:`, and space/`\n`/`\t`-prefixed `javascript:` rejected; `data:`, `file:///…`, `file://C:/…`, `http:`, `vscode://`, `ptah://`, `//host`, `/path`, bare host and empty string rejected; `https://user:pass@host` rejected; a `javascript:` URL inside a list item rejects the whole spec; the same check applies to an action's `url`. |
| 5 | Host mediation of every action | `DashboardActionSchema` carries `{ action, label, url?, params }` only, `params` values are scalars, and `DashboardDataRef.resultId` is an opaque slug | `dashboard-trust-boundary.spec.ts` → `control 5`: a `toolName`/`tool`/`rpcMethod`/`method`/`command`/`handler`/`script`/`eval` key on an action is rejected (8 cases); an accepted action's keys are exactly `action`, `label`, `params`; `url` is accepted only on `dashboard.open-url` and is required there; a `resultId` of `../../etc/passwd`, an https URL, `/tmp/x`, `a b` or `SELECT * FROM t` is rejected, so a spec value cannot become a path, a fetch or a query. |

Honest scope of controls 3 and 5: the renderer-side halves — "no `innerHTML`,
text binds as text" and "the renderer never calls a tool or an RPC method
directly" — belong to TASK_2026_494 and cannot be tested from a shared lib. What
is tested here is that the contract makes the unsafe thing *unexpressible*:
there is no HTML field to bind, and no field in which a spec could name an
executable. Each assertion in the spec says so in a comment.

## Decisions

**1. Secondary entry point, not a new Nx project.** The contract is
`@ptah-extension/shared/mcp-apps-contracts` →
`libs/shared/src/mcp-apps-contracts/index.ts`, inside the existing `libs/shared`
project. Four reasons, in order of weight:

- A nested project at `libs/shared/mcp-apps-contracts` would sit *inside*
  another project's root. `libs/shared/jest.config.ts` has `rootDir`
  `libs/shared`, so its Jest run would pick up the nested project's spec files
  as well as its own, and `nx.json`'s default `{projectRoot}/**/*` input would
  make every change to the child invalidate the parent's cache. `libs/shared` is
  a project, not a directory of projects — `critique-engineering.md` section 3
  names the path without accounting for that.
- `libs/shared/project.json` already carries **exactly** the two tag axes the
  critique asks for: `["scope:shared", "type:util"]`. The boundary the tags
  express is satisfied as written.
- `@ptah-extension/shared/schemas` is an established, documented precedent for
  this shape: `libs/shared/src/schemas.ts` exists specifically to keep every
  zod-bearing module out of the main `export *` barrel, which was costing the
  webview ~304 kB. The dashboard contract is zod-bearing, so it belongs behind a
  narrow entry point for the same reason. `@ptah-extension/shared/testing` is the
  second precedent, and the one whose directory-plus-`index.ts` layout this
  follows.
- Named `mcp-apps-contracts` rather than `dashboard-contracts` so the rest of
  the lane (app descriptors, view messages, stored manifests) lands in the same
  place, as the critique's table intends.

No `eslint.config.mjs` `checkDynamicDependenciesExceptions` entry was added, and
one is not required. That option's four existing entries
(`tasks-ui/services`, `harness-builder/services`, `marketplace/services`,
`marketplace/harness`) exist for one specific reason recorded in the config: those
libs are **lazy-loaded by the webview composition root** via
`import('@ptah-extension/<lib>')`, and a static import of a subpath would
otherwise be flagged as defeating the code split. `shared/schemas` and
`shared/testing` are subpaths of the same kind and have no entry, because a
static import of a subpath of a project a consumer already depends on is not a
boundary violation at all. Adding an entry for `shared/mcp-apps-contracts` would
weaken a guard to no purpose. `nx run-many -t lint` passes with 0 errors, which
is the evidence.

**2. Provisional budgets, and no renderer.** `context.md` asks for the numbers to
be "confirmed with a render test". The renderer is TASK_2026_494 and does not
exist. A number "confirmed" against a renderer that does not exist would be a
fabrication, and building a render harness here would duplicate the work
TASK_2026_494 owns. So the seven starting values ship unchanged and are marked
provisional in three places: the doc comment on `DASHBOARD_LIMITS`, the limit
table above, and the tool description an agent reads. They live in exactly one
constant, read by the schemas, the rejection text and the tests, so TASK_2026_494
confirms or replaces a number by editing one line and re-running
`nx run-many -t test` — no test in this task hardcodes a budget. The two
*non*-render-dependent values are marked confirmed: the duplicate-id rule (no
number to measure) and the 20-row text-fallback cap (fixed by `context.md`).

**3. The byte counter is injected, not imported.** `context.md` requires the
UTF-8 check to come from `libs/backend/platform-core/src/utils/json-budget.ts`.
`libs/shared` cannot import `platform-core`:

- `jsonUtf8Bytes` uses `Buffer`, which the webview — the *second* measurement
  point, which TASK_2026_494 owns — does not have. This reason is decisive on
  its own.
- `platform-core` already imports a type from `@ptah-extension/shared`
  (`interfaces/boot-readiness.interface.ts:20`) and documents that it must stay
  free of a dependency on it (`settings-auth-key.ts:9-10`), so a
  `shared → platform-core` edge would close a project cycle.

So `validateDashboardSpec(input, countUtf8Bytes)` takes the counting primitive as
an argument while the **budget** stays in `DASHBOARD_LIMITS`. The backend passes
the real `jsonUtf8Bytes` from `@ptah-extension/platform-core`
(`dashboard-namespace.builder.ts`), and
`dashboard-namespace.builder.spec.ts` → `the byte budget is measured here` proves
that path: exactly-at-limit accepted, one byte over rejected, and a spec that is
under the limit by `JSON.stringify(...).length` but over it in UTF-8 bytes (a
string of emoji) is still refused. TASK_2026_494 calls the same function with a
`TextEncoder`-based counter — that is stated in the validator's own doc comment
so the second boundary cannot invent a second opinion about validity.

**4. Bytes are measured before the parse, not after.** Measuring the parsed value
would measure a document the agent did not send, and would walk a 10 MB spec in
full before refusing it. The order is: count bytes → refuse if over → zod parse.

**5. `children` on every kind, rather than a sixth "group" kind.** `context.md`
requires exactly five component kinds *and* a max tree depth of 8, which only
makes sense if the tree nests. Adding a container kind would break the
five-kind rule that deliverable 3 and its unknown-kind rejection test depend on.
So every component may carry `children`, documented as layout nesting. Depth,
tree-wide component count and id uniqueness are therefore envelope-level
refinements (`countDashboardComponents`, `dashboardTreeDepth`,
`collectDashboardComponentIds`), not per-node ones.

**6. No RPC namespace, so no dual registration.** The transport contract is one
**push** message, exactly as `harness:config-proposed` is. Nothing in this task
is called *by* the webview, so there is no RPC method, and therefore no entry
belongs in `rpc.types.ts` or in `ALLOWED_METHOD_PREFIXES`. If TASK_2026_494 needs
to pull a spec or send an action back, that is an RPC namespace it adds, with both
registrations.

**7. The tool is always-on and has no namespace toggle.** It sits in the
unconditional block of `handleToolsList` beside the task tools, for the reason
recorded there: its success result *is* the dashboard in plain text, so it is the
answer on a host with no page rather than a dead end, and an agent that cannot
rely on it writes a markdown table instead. A toggle would also need a
`disabledMcpNamespaces` value surfaced in the settings UI, which is frontend work
this task must not touch. `PtahAPI.dashboard` is non-optional for the same
reason: its only collaborator is a broadcast callback, so there is no host on
which it must degrade.

**8. The tool definition lives in its own file.** `tool-description.builder.ts` is
1,841 lines — already over the 700-line soft ceiling and already emitting a
`max-lines` warning — and this is the only tool whose schema is generated, so it
carries an import the hand-written builders have no use for. The existing
`mcp-core/agent-spawn-args.schema.ts` is the precedent for a per-tool schema
module beside the shared builder.

**9. `draft-7` JSON Schema, and a named `$defs` entry.** `children` makes the
component union recursive, so `z.toJSONSchema` must emit it as a definition plus
a `$ref`; there is no non-recursive encoding of a tree. `target: 'draft-7'` puts
it under `definitions`, the keyword the widest set of MCP clients understands,
and `.meta({ id: 'DashboardComponent' })` on the union gives it a readable name
instead of `__schema0`. `$schema` is stripped because an MCP `inputSchema` is a
fragment, not a document.

**10. The types are hand-declared in a zod-free `.types.ts` and the schemas are
bound to them with `satisfies` — and this is a CORRECTION I made after finding a
regression.** The first version inferred every non-recursive type with `z.infer`
and had `payload-map.ts` `import type` the envelope from the schemas module.
`nx affected -t typecheck` then failed `@ptah-extension/settings-core`:

```
libs/shared/src/mcp-apps-contracts/dashboard-spec.schemas.ts:429:14 - error TS2322:
Type 'ZodDiscriminatedUnion<...>' is not assignable to type 'ZodType<DashboardComponent, ...>'.
  Property 'value' is optional in type '{ kind: "stat"; id: string; value?: string | number; ... }'
  but required in type 'DashboardStatComponent'.
```

The cause is not the annotation. `tsconfig.base.json` sets `"strict": false`, and
twenty backend libs never override it — `settings-core`, `cli-agent-runtime`,
`task-specs`, `persistence-sqlite` and the rest. Under `strictNullChecks: false`
`undefined` is assignable to every type, so zod's "is this key optional?"
inference marks **every** key optional, and a zod-inferred type reached from the
main barrel fails to compile in those projects — inside `libs/shared`'s own
source, not at the import site. An `import type` does not help: it is erased at
runtime but the file still enters the consumer's type program.

The fix is the repository's own established pattern, which I should have followed
from the start: `provider-profile.types.ts` (plain interfaces, exported from the
main barrel) plus `provider-profile.schemas.ts` (zod, behind `/schemas`, bound
with `satisfies z.ZodType<ProviderProfile>`), dependency direction one-way
schemas → types. So `dashboard-spec.types.ts` now holds the published types with
no zod import and is exported from `libs/shared/src/index.ts`, `payload-map.ts`
imports from there, and every schema carries
`satisfies z.ZodType<…>` so the two cannot drift — a field added to one and not
the other fails `libs/shared:typecheck`.

`DashboardComponentSchema` is the one schema that keeps an *annotation* rather
than `satisfies`: `children` makes it self-referential, and TypeScript reports
TS7022/TS7023 ("implicitly has type `any` because it … is referenced … in its own
initializer") for a recursive schema with no annotation (I reproduced this before
choosing the shape). The annotation both breaks the cycle and does the
`satisfies` job.

Residual fragility, stated plainly: a future **non-strict** lib that imports
`@ptah-extension/shared/mcp-apps-contracts` directly would hit the same error,
because zod inference is strictness-dependent wherever it is compiled. The
existing `@ptah-extension/shared/schemas` entry point has the identical property.
Nothing in this task can remove that; the real fix is `"strict": true` in those
twenty tsconfigs, which is not my batch.

**11. The dispatcher does no pre-validation.** The `tools/call` case forwards
`args.spec` untouched, not even checking that it is an object. Any such check
would be a second, weaker copy of the zod contract, and a near-miss rejected
there would report a worse reason than the validator's. This is a deliberate
divergence from `ptah_harness_propose_config`, which does pre-check its
`configUpdates`; it is commented at the call site and pinned by a test
(`forwards a missing 'spec' to the validator rather than pre-judging it`).

**12. The namespace returns an outcome instead of throwing.** `proposeConfig`
throws on rejection. The dashboard tool must produce `isError: true` *and*
guarantee that no push happened, and a discriminated
`{ status: 'accepted' | 'rejected' }` expresses that to the dispatcher in a way a
thrown error cannot. It also makes "rejected ⇒ broadcast not called" directly
assertable.

**13. Zod is 4.6.5, not 4.3.6.** The task brief says the pin is 4.3.6;
`node -e "require('zod/package.json').version"` reports `4.6.5` and
`libs/shared/package.json` declares `^4.1.12`. I used what is installed. Nothing
in the contract depends on a 4.4+ feature — `z.toJSONSchema`, `z.iso.datetime`,
`z.enum` over a `readonly` tuple and object getters/`z.lazy` recursion are all
4.0 surface — but the discrepancy is worth knowing.

## Verification

`npx nx reset` **failed**, twice, and I am reporting it rather than papering over
it. Verbatim:

```
$ npx nx reset

 NX   Resetting the Nx cache and stopping the daemon.

 NX   Failed to reset the Nx workspace.

Failed to clean up the workspace data directory.
Error: EPERM, Permission denied: \\?\C:\Users\abdal\.nx\8b7110c7390b9603\databases '\\?\C:\Users\abdal\.nx\8b7110c7390b9603\databases'
```

Stopping the daemon first (`npx nx daemon --stop` → `Daemon Server - Stopped`)
did not help — the SQLite database file under the workspace-data directory is
held open by another process, most likely a concurrent Nx run in one of the
sibling worktrees. The partial delete then broke the cache directory outright:

```
Error: ENOENT: no such file or directory, open 'C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\15737175299309916314'
```

I repaired it with `mkdir -p '/c/Users/abdal/.nx/8b7110c7390b9603/cache/terminalOutputs'`
and ran every target with `NX_DAEMON=false --skip-nx-cache`, which bypasses both
the daemon's graph and the cache and so achieves what `nx reset` was for. The
stale-graph hazard the brief warns about does not apply to this change in any
case: I added **no** `project.json` and **no** new target, because the contract
is a secondary entry point of an existing project (Decisions 1).

### typecheck, lint and test — the final run, after the Decisions 10 fix

```
$ NX_DAEMON=false npx nx run-many -t typecheck lint test -p @ptah-extension/shared @ptah-extension/vscode-lm-tools --skip-nx-cache --output-style=static

 NX   Running targets typecheck, lint, test for 2 projects:

✖ 3 problems (0 errors, 3 warnings)            <- @ptah-extension/shared:lint
Test Suites: 63 passed, 63 total               <- @ptah-extension/shared:test
Tests:       1690 passed, 1690 total
✖ 44 problems (0 errors, 44 warnings)          <- @ptah-extension/vscode-lm-tools:lint
Test Suites: 52 passed, 52 total               <- @ptah-extension/vscode-lm-tools:test
Tests:       1190 passed, 1190 total

 NX   Successfully ran targets typecheck, lint, test for 2 projects
```

The header reads `for 2 projects` and both projects printed their own suite
counts, so neither was silently turned into a path filter. 138 of those tests
are new: 111 in `libs/shared` (18 budgets + 60 trust boundary + 33 contract) and
27 in `vscode-lm-tools` (14 namespace + 13 tool). Each new spec file was also run
in isolation during development.

### lint detail

0 errors, 47 warnings, every one of them pre-existing. Scoping eslint to only
the files this task created returns nothing at all:

```
$ npx eslint libs/shared/src/mcp-apps-contracts libs/shared/src/testing/fixtures/dashboard-spec.ts --format stylish
(no output)
```

I checked the two files I *did* edit that appear in the warning list:

```
protocol-dispatcher.ts
  917:1  warning  File has too many lines (1770). Maximum allowed is 700  max-lines
system-namespace.builders.ts
  536:11  warning  There is no `cause` attached to the symptom error being thrown  preserve-caught-error
  538:9   warning  There is no `cause` attached to the symptom error being thrown  preserve-caught-error
```

`protocol-dispatcher.ts` was 2,122 physical lines before this change and is 2,163
after (`max-lines` counts 1,770, excluding comments and blanks), so it was far
over the ceiling and already emitting this warning before I touched it — my
additions are the 8-line `tools/list` entry, the 26-line `tools/call` case and
two imports. Every file this task CREATED is under the 700-line ceiling; the
largest is `dashboard-spec.schemas.ts` at 557. The two `preserve-caught-error` warnings in
`system-namespace.builders.ts` are at line 536, in pre-existing `files` namespace
code, not in the help-text block I added. None of the new files
(`mcp-apps-contracts/*`, `dashboard-namespace.builder.ts`,
`dashboard-propose-spec.tool.ts`, `testing/fixtures/dashboard-spec.ts`) appears
in the lint output at all.

### coverage (both projects enforce thresholds in their `ci` configuration)

```
$ npx jest --config libs/shared/jest.config.ts --rootDir libs/shared --coverage
Statements   : 94.59% ( 2747/2904 )      threshold 85
Branches     : 86.97% ( 1562/1796 )      threshold 85
Functions    : 79.47% ( 457/575 )        threshold 70
Lines        : 95.10% ( 2487/2615 )      threshold 85

$ npx jest --config libs/backend/vscode-lm-tools/jest.config.ts --rootDir libs/backend/vscode-lm-tools --coverage
Statements   : 82.74% ( 3516/4249 )      threshold 75
Branches     : 67.53% ( 1870/2769 )      threshold 60
Functions    : 87.41% ( 639/731 )        threshold 85
Lines        : 83.30% ( 3442/4132 )      threshold 75
```

Both clear every threshold. I ran these because `tsconfig.base.json` and a
`package.json` `exports` map changed, and a coverage regression under the CI
configuration would otherwise only surface in CI.

### workspace-wide collateral check — this is where the real finding came from

`tsconfig.base.json` is a `sharedGlobals` input, so every project is affected. I
ran the whole thing, twice.

**First run (before the Decisions 10 fix): 94 projects, 16 failures.** One of
them was mine:

```
 NX   Running target typecheck for 94 projects failed

Failed tasks:
- @ptah-extension/settings-core:typecheck
- api-core:typecheck
- api-identity:typecheck
  … 13 more api-* / ptah-license-server / ptah-landing-page-e2e
```

`@ptah-extension/settings-core` was a genuine regression from my change; the
error and the root cause are in Decisions 10, and fixing it is why the contract
is now split into `.types.ts` + `.schemas.ts`.

**Second run (after the fix): 94 projects, 15 failures, 79 successful.**

```
$ NX_DAEMON=false npx nx affected -t typecheck --base=origin/main --parallel=3 --skip-nx-cache

 NX   Running target typecheck for 94 projects failed

Failed tasks:

- api-core:typecheck
- api-identity:typecheck
- api-audit:typecheck
- api-membership:typecheck
- api-notifications:typecheck
- api-community:typecheck
- api-marketing:typecheck
- api-licensing:typecheck
- api-admin:typecheck
- api-forum:typecheck
- api-learning:typecheck
- api-member-hub:typecheck
- api-billing:typecheck
- ptah-license-server:typecheck
- ptah-landing-page-e2e:typecheck

Output of 79 successful tasks were not shown.
  Run duration:      5m 45s
```

`settings-core` is gone and the success count went 78 → 79. **All 15 remaining
failures are pre-existing and unrelated**, and I verified that rather than
assuming it:

```
$ NX_DAEMON=false npx nx run api-core:typecheck --skip-nx-cache --output-style=static
libs/api/core/src/index.ts:5:15 - error TS2307: Cannot find module
  './lib/generated-prisma-client/client' or its corresponding type declarations.

$ ls libs/api/core/src/lib/generated-prisma-client
ls: cannot access '...': No such file or directory

$ grep -n "prisma:generate" package.json
20:  "prisma:generate": "cd apps/ptah-license-server && npx prisma generate",
```

The Prisma client is a generated artifact that nobody has generated in this
worktree; the whole `api-*` / license-server / landing-e2e block fails on it.
Grepping every one of those runs for `mcp-apps-contracts` returns zero matches.

**Belt and braces on the strictness hazard.** Because the regression was
strictness-related and the affected graph is coarse, I also typechecked all
twenty non-strict backend libs directly:

```
cli-agent-runtime OK   task-specs OK        persistence-sqlite OK   harness-sync OK
thoth-runtime OK       skill-synthesis OK   output-styles OK        memory-curator OK
auth-providers OK      auth-providers-tokens OK   cli-engine OK     cron-scheduler OK
gateway-chat-bridge OK memory-contracts OK  messaging-gateway OK    platform-cli OK
plugin-marketplace OK  settings-core OK     voice-contracts OK      voice-providers OK
```

Two more things I checked by hand rather than by tool:

- `grep -rn "keyof MessagePayloadMap"` outside
  `libs/shared/src/lib/types/messages` finds only generic constraints in
  `libs/backend/vscode-core/src/validation/message-validator.service.ts`. There
  is no exhaustive `Record<keyof MessagePayloadMap, …>` that a new key would
  break.
- `PtahAPI.dashboard` is non-optional, which *is* a breaking change to that
  interface. Every construction site outside `types.ts` goes through
  `as unknown as PtahAPI` (`protocol-dispatcher.spec.ts:75`,
  `code-execution.engine.spec.ts:46`, `code-execution.sandbox-escape.spec.ts:52`),
  so none needed updating — and `vscode-lm-tools`, the only lib that builds a
  real `PtahAPI`, typechecks and passes its 1,190 tests.

## Deferred

- **The renderer and the second measurement point.** The webview RPC boundary is
  TASK_2026_494, as the task boundary requires. `validateDashboardSpec` is
  written to be called there unchanged, and its doc comment says so.
- **Confirming the budgets.** All seven are provisional; see Decisions 2.
- **Persisting or pinning a spec.** `revision` exists in the envelope and is
  validated as a positive integer, but nothing interprets it, and there is no
  `baseRevision`/`sequence` incremental-update contract. Critique
  `critique-engineering.md` section 5 and Revision 4 sequence A step 3 put that
  after the renderer; every call replaces the previous spec in full, which is
  what "atomic snapshots for v1" means.
- **Resolving a `DashboardDataRef`.** The contract defines the opaque handle and
  the `dashboard.drill-down` action that asks the host to expand it. Nothing
  resolves a `resultId` yet — there is no result store, and inventing one here
  would be a data-access lib the plan did not ask for.
- **Migrations between schema versions.** `DASHBOARD_SUPPORTED_SCHEMA_VERSIONS`
  and `DASHBOARD_SUPPORTED_CATALOG_VERSIONS` are single-element lists, so there
  is nothing to migrate yet. The critique's "forward-only, explicit" rule is
  recorded in the doc comments; the machinery arrives with the second version.
- **A namespace toggle for the dashboard tool.** See Decisions 7 — it would need
  a settings-UI change, which is out of scope.
- **`MCP_MVP_TOOL_NAMES`.** The stdio/CLI transport exposes a deliberately narrow
  eight-tool MVP set (agent orchestration plus `session_submit`). Adding the
  dashboard tool there is a separate decision about that transport's surface, not
  part of this contract.

## Risks for the reviewer

1. **The generated JSON Schema uses `$ref` + `definitions`.** Every other tool in
   this repository hand-writes a flat `{ type, properties, required }`, and this
   is the first one whose `inputSchema` contains a `$ref`. That is forced — the
   component tree is recursive and generation from zod is a hard requirement of
   deliverable 4 — but I could not verify how each MCP client in play (the Claude
   Agent SDK, Codex, Cursor, Copilot) handles a `$ref` in a tool's `inputSchema`.
   If one of them rejects or flattens it, the fallback is to cap nesting in the
   *schema* by unrolling `children` to a fixed depth, which is ugly but
   representable. **This is the finding I am least confident about, and it is the
   one worth an actual end-to-end tool-list check against a real client.**
2. **The strictness hazard is contained, not removed.** A future non-strict
   project that imports `@ptah-extension/shared/mcp-apps-contracts` directly will
   fail to typecheck for the reason in Decisions 10, and the failure will point
   at `libs/shared`'s source rather than at the import that caused it. The entry
   point's doc comment warns about this and names the alternative (import the
   plain types from the main barrel), but a warning in a comment is not a guard.
   The real fix is `"strict": true` in the twenty backend tsconfigs that inherit
   `false`; that is a workspace-wide change, not my batch, and I have not
   assessed how much it would break. Worth raising with the architect.
3. **The 15 remaining workspace typecheck failures are pre-existing, and I am
   asserting that from evidence rather than from a clean baseline.** I did not
   run the affected typecheck on an untouched checkout to compare. What I have
   instead: the error is a missing generated Prisma client, the directory really
   is absent, `prisma:generate` really is a manual script, and none of those runs
   mentions any file this task touched. If a reviewer wants certainty, run
   `npm run prisma:generate` and re-run — but they will fail identically on
   `origin/main`.
4. **`children` on every kind is a judgment call, not a requirement.**
   `context.md` mandates five kinds and a depth budget without saying how the
   tree nests. If TASK_2026_494 finds that nesting a `table` inside a `stat` is
   meaningless to render, the honest fix is to restrict `children` to specific
   kinds — which narrows the contract and is a safe change — rather than to add a
   sixth kind.
5. **The source-scan tests are regex over comment-stripped text.** The `any` and
   `innerHTML` assertions in `dashboard-trust-boundary.spec.ts` are a text scan,
   not a parse. The comment stripper is naive and would mangle a regex literal
   containing `//` or a block-comment opener; no contract file has one today and
   the helper's doc comment says to keep it that way. A stricter version would be
   an ESLint rule scoped to the contract directory, which is a lint-config change
   I judged out of scope.
6. **The cycle half of Decisions 3 is reasoned, not measured.** I did not
   empirically confirm that `@nx/enforce-module-boundaries` rejects a
   `shared → platform-core` edge; I read the existing type-only import in
   `platform-core` and the repository's own comment forbidding the dependency.
   The `Buffer`-in-the-webview reason is independently decisive, so the design
   does not rest on the cycle claim.
7. **Failing `nx reset` means the cache state on this machine is unusual.** I
   created a directory under `C:\Users\abdal\.nx\8b7110c7390b9603\cache\` to
   repair what the failed reset deleted. That path hash is derived from this
   worktree's root so it should not touch a sibling worktree, but a reviewer
   seeing odd Nx behaviour here should suspect the shared `~/.nx` state before
   suspecting the diff.
8. **`DASHBOARD_MARKDOWN_CHOKEPOINT` is a string constant, not an enforced
   dependency.** It records the renderer's obligation to route `format:
   'markdown'` through `@ptah-extension/markdown`. Nothing in this task can make
   TASK_2026_494 honour it; the enforceable part — that the contract offers no
   HTML field and no third format — is what the tests cover.
   **Superseded by revision round 1: markdown and this constant are both gone.
   Risk 8 was, in hindsight, the wrong reading of a real hole — see finding 1.**

---

## Revision round 1

Four confirmed findings from `code-logic-review.md`, all fixed. I reproduced
every one against the real code before changing anything, and each fix has a
test that fails without it. No finding was argued back: all four were correct,
and two of them found holes in my own tests rather than only in my code.

### Finding 1 (BLOCKING) — markdown was an alternate URL channel

**Reproduced first**, through the real validator:

```
F1 markdown data: url -> ACCEPTED (defect)
```

with the reviewer's payload,
`title: { format: 'markdown', text: '![x](data:image/png;base64,AAAA)' }`. I
confirmed the second half of the mechanism by reading the chokepoint rather than
re-running `marked`: `provide-markdown-rendering.ts:72` sets
`ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data):|…)/i`, so the sanitizer the
contract pointed at explicitly permits `http:` and `data:`. The contract was
contradicting `context.md:44` through the one channel it documented as safe.

**Fix — the contract narrowed, no second parser.** `DASHBOARD_TEXT_FORMATS` is
now `['plain']`. I checked the coordinator's rationale rather than taking it, and
it holds on all three points: narrowing rejects strictly more, so it cannot break
a valid spec; a real link already has a home in `dashboard.open-url`, whose `url`
goes through `isAllowedDashboardUrl`; and `catalogVersion` is the versioning seam
for a richer text format later. I did **not** add markdown URL extraction — that
would be a second parser, and it and `marked` would eventually disagree.

Markdown is not load-bearing for anything: the only renderer is TASK_2026_494,
which does not exist, and nothing else reads `DashboardRichText.format`.

`DASHBOARD_MARKDOWN_CHOKEPOINT` was removed too. It pointed a renderer at
`@ptah-extension/markdown` for a path the contract no longer permits, and an
export documenting a forbidden route is worse than no export.

| Where | What |
| --- | --- |
| `dashboard-catalog.ts` (the `DASHBOARD_TEXT_FORMATS` block) | `['plain']`, plus the reproduction, the reasoning, and the two conditions for ever restoring markdown — a URL policy the chokepoint can actually enforce, and a `catalogVersion` bump. |
| `dashboard-catalog.ts` (removed) | `DASHBOARD_MARKDOWN_CHOKEPOINT`, and its re-export from `index.ts`. |
| `dashboard-spec.types.ts`, `DashboardRichText` | Now states that no text field in the contract may be parsed. |
| `dashboard-propose-spec.tool.ts` | Description teaches PLAIN TEXT and points at `dashboard.open-url` instead. |

**Tests** — `dashboard-trust-boundary.spec.ts`, control 3 (that file is now 80
tests, was 60):

- `admits exactly ONE text format, plain, …` — pins `['plain']`; fails the moment a format is added back.
- `rejects the text format 'markdown' | 'html' | 'raw' | 'md' | 'PLAIN'`.
- `gives %p no interpreted channel through a title` and `… through a list item, the other reported route` — the seven URL-bearing payloads (`![x](data:…)`, `![x](http://…)`, `[link](data:text/html,<script>…)`, `[link](http://…)`, raw `<img src="http://…">`, raw `<img src="data:…">`, and a reference-style `[ref][1]` destination) are rejected when they opt into markdown, and accepted only as literal text with `format` undefined.
- `keeps a data: or http: URL out of every scheme-checked field` — the same two schemes are still refused in a list item's `url` and an action's `url`, so narrowing left no softer route open.
- `names no markdown renderer, so nothing directs a consumer to one`.

Being precise about what those prove: the contract no longer has any value of
`format` that licenses a consumer to parse a text field, so the *channel* is
closed. A renderer that parses plain text anyway is a renderer bug, and
TASK_2026_494's own tests are where that is caught — a shared lib cannot assert
it.

### Finding 2 (BLOCKING) — a failed delivery was reported as success

**Reproduced first**, as a temporary spec against the real `WebviewManager` with
a surface whose `postMessage` throws. The old line —
`void webviewManager.broadcastMessage(type, payload)` — gave `undefined` to base
an outcome on, and the rejection escaped:

```
● OLD WIRING: void broadcastMessage reports nothing and leaks the rejection
  disposed during postMessage
    at WebviewManager.broadcastMessage (../vscode-core/src/api-wrappers/webview-manager.ts:304:38)
```

Both halves of the finding in one run. That scratch spec was deleted; its
permanent equivalent is listed below.

**Fix — observe the delivery, and give it its own outcome.** I checked the
coordinator's warning rather than assuming: `await` alone would not have worked.
`broadcastMessage` deliberately swallows and logs an ordinary rejected post
promise (`webview-manager.ts:304-314`), so awaiting it resolves to `undefined`
just as happily when nothing was delivered. There is no delivery signal on that
method to await.

`getActiveWebviews()` + `sendMessage()` is the public pair that does report one:
`sendMessage` catches a throwing or rejecting `postMessage` itself
(`webview-manager.ts:211-226`) and returns a real per-surface boolean, so nothing
escapes and every surface is still attempted. No change to `vscode-core` was
needed.

| Where | What |
| --- | --- |
| `dashboard-namespace.builder.ts`, `createDashboardBroadcast` | Enumerate surfaces, send per surface, count. Its doc comment carries the reproduction and why `await` was not the fix. |
| `dashboard-namespace.builder.ts`, `DashboardDeliveryOutcome` | `delivered` \| `no-surface` \| `failed` (with `delivered` / `surfaces` counts). |
| `dashboard-namespace.builder.ts`, `DashboardProposeSpecOutcome` | Third variant `delivery-failed`, carrying the text and the counts. |
| `ptah-api-builder.service.ts` | Wired through the factory; the `void` call is gone. |
| `protocol-dispatcher.ts` | `delivery-failed` → `isError: true` with the reason **and** the dashboard text. |

The three required semantics hold exactly. Validation rejection stays strictly
before any dispatch and is a different outcome from delivery failure — they carry
different information, and the delivery failure says how many surfaces did
receive it, because one of them may already be on screen. A host with **no**
surface is `no-surface`, which is a **success**: the deliberate CLI and headless
path, kept as a separate status rather than folded into `delivered` so the
difference stays legible in a log.

**Tests** — `dashboard-namespace.builder.spec.ts` (28 tests, was 14):

- `reports failure — not success — for a surface that throws during disposal, and lets nothing escape` — the reviewer's scenario end to end against the **real** `WebviewManager`, asserting `delivery-failed`, `{ delivered: 0, surfaces: 1 }`, and an empty `unhandledRejection` list after a tick.
- `reports failure for a surface whose postMessage rejects` — the other failure mode, the one `await` alone would have missed.
- `reports delivered for a healthy surface`; `reports no-surface when no host is registered`; `… when a host is registered but nothing is attached`; `reports failure, and how many landed, on a partial delivery`; `attempts every surface even when an earlier one fails`.
- `is NOT reported as accepted`; `stays distinguishable from a validation rejection`; `still carries the dashboard text…`; `says how many surfaces DID receive it…`; `treats a host with no surface at all as a SUCCESS, not a delivery failure`.
- `dashboard-propose-spec.tool.spec.ts`: `returns isError — not success — when delivery to the UI failed`, and `keeps a host with NO surface a success, because that path is deliberate`.

### Finding 3 (SERIOUS) — a 51 KB spec overflowed the stack

**Reproduced first**, and it was worse than reported:

```
F3 depth 9   (672 bytes)   -> rejected
F3 depth 200 (10323 bytes) -> rejected
F3 depth 999 (51072 bytes) -> THREW RangeError: Maximum call stack size exceeded
F3 200k-deep foreign key: jsonUtf8Bytes THREW RangeError
   validate -> THREW RangeError
```

The last two lines are mine, not the reviewer's. `jsonUtf8Bytes` is
`JSON.stringify`, which recurses over the **whole** value including a key the
schema never visits, so deep nesting under an unknown key throws inside the byte
count — before any budget is read, and before a structural guard could run. A
guard on the component axis alone would not have made the validator
non-throwing.

**Fix — two layers**, in `dashboard-spec.validator.ts`:

1. `findStructuralBreach`: an **iterative** walk with an explicit stack over the only recursive axis (`components` → `children`), run **before** the zod parse, stopping one level past the budget rather than walking to the bottom of a hostile tree. Every other nesting in the contract has a fixed, shallow depth that a non-recursive schema already bounds.
2. An outer `try`/`catch` — `catch (error: unknown)`, narrowed with `instanceof Error` before `.message` — turning any throw, including the byte counter's, into a rejection with a plain-text reason. `DashboardSpecRejected.bytes` became optional, documented as "absent only when the input could not be measured", rather than reporting a fabricated `0`.

Every case above now returns a rejection; none throws.

**A consequence I decided deliberately.** The pre-check makes the envelope's
depth/count `superRefine` unreachable *through the validator*. I kept both and
made them word the breach identically, because the refinements are the only
guard for a caller that uses `DashboardSpecEnvelopeSchema` directly — which the
contract's own specs do and TASK_2026_494 may. That duplication is now stated at
`findStructuralBreach` rather than left to be discovered. My own test run is what
surfaced it: the existing 201-component test started failing because the
pre-check's wording differed from the refinement's.

**Tests** — `dashboard-budgets.spec.ts`:

- `returns a rejection for a tree 9 / 200 / 999 levels deep instead of throwing`, each asserting the spec is *inside* the byte budget first — because the byte check is precisely what cannot save us here.
- `returns a rejection for a tree so deep that measuring it overflows too` (5,000 levels; asserts `dashboardJsonBytes` itself throws `RangeError`, and the validator still answers).
- `rejects, without throwing, a nesting depth that overflows the byte counter itself` (200,000 levels under a foreign key; asserts `bytes` is `undefined`, not a made-up number).
- `still rejects an over-depth tree through the zod refinement for a parseable one` — pins that the pre-check did not replace the refinements.
- `dashboard-namespace.builder.spec.ts`: `rejects a pathologically deep spec rather than letting it throw`, asserting nothing was dispatched.

### Finding 4 (MODERATE) — `generatedAt` escaped the string cap

**Reproduced:** `F4 generatedAt length 2022 -> ACCEPTED (defect)`.

**Fix:** `.max(MAX_STRING)` on the ISO schema in `dashboard-spec.schemas.ts`,
with a comment recording that this is not redundant beside the format check —
ISO 8601 permits fractional seconds of arbitrary length.

**Tests** — `dashboard-budgets.spec.ts`, in the at-limit/over-limit shape the
rest of that file uses: `accepts a generatedAt of exactly 2000 characters` and
`rejects a generatedAt of 2001 characters`.

### The correction to this note — the `satisfies` claim was overstated

The reviewer is right, and I removed the claim rather than softening it.
`satisfies z.ZodType<T>` checks **assignability, one way**. It catches a required
field the schema drops and a field whose schema type no longer fits. It does
**not** catch a field added to the schema only — a wider object is still
assignable. Decision 10 and the comment in `dashboard-spec.types.ts` both
asserted a bidirectional guarantee that does not exist.

Added the seven missing `satisfies` clauses, which were cheap and all held:
`DashboardUrlSchema`, the five component schemas, and
`DashboardProposeSpecInputSchema` — 17 in the file now, up from 10.

Rewrote the claim in both places to state the exact scope, including why an
exact-equality assertion is **not** cheap here: the declared types use `readonly`
arrays and zod infers mutable ones, so mutual assignability fails on a difference
that does not matter. The schema-only direction is guarded at runtime instead —
every object is `.strict()` — and by the contract specs. **This section
supersedes the last paragraph of Decision 10 above**, which I left in place
rather than silently editing history.

### The user decision recorded

`context.md` gained a `## Decisions from review` section with three entries: the
`sessionId` rule (**a spec with no `sessionId` produces the plain-text tool
result and renders nowhere** — absence means "not mine", never the active
session, because otherwise an anonymous MCP caller could inject a surface into
whatever the user has open, and **TASK_2026_494 needs a test asserting it renders
nowhere**), the plain-text rule from finding 1, and the delivery-outcome rule
from finding 2.

### Verification — real output

```
$ NX_DAEMON=false npx nx run-many -t typecheck lint test -p @ptah-extension/shared @ptah-extension/vscode-lm-tools --skip-nx-cache

 NX   Running targets typecheck, lint, test for 2 projects:

√  nx run @ptah-extension/shared:test
√  nx run @ptah-extension/shared:lint
√  nx run @ptah-extension/shared:typecheck
√  nx run @ptah-extension/vscode-lm-tools:test
√  nx run @ptah-extension/vscode-lm-tools:typecheck
√  nx run @ptah-extension/vscode-lm-tools:lint

 NX   Successfully ran targets typecheck, lint, test for 2 projects

  Run duration:      42.1s
  Cache:             Skipped (--skip-nx-cache)
```

Per-project counts, from the same command with `--output-style=static`:

```
@ptah-extension/shared           Test Suites: 63 passed, 63 total   Tests: 1718 passed, 1718 total
                                 ✖ 3 problems (0 errors, 3 warnings)
@ptah-extension/vscode-lm-tools  Test Suites: 52 passed, 52 total   Tests: 1207 passed, 1207 total
                                 ✖ 44 problems (0 errors, 44 warnings)
```

Tests went 1690 → 1718 (shared, +28) and 1190 → 1207 (vscode-lm-tools, +17): 45
new tests across the four findings. 0 lint errors; all 47 warnings are the same
pre-existing ones as round 0, and `npx eslint` scoped to every file this task
created still returns nothing.

`nx reset` was NOT run, per the instruction — a sibling worktree's daemon holds
the Nx database and it fails with `EPERM`. Everything ran with
`NX_DAEMON=false --skip-nx-cache`, which bypasses both the daemon's graph and the
cache.

**No affected sweep this round, and that is a decision rather than an omission.**
Neither `tsconfig.base.json` nor `libs/shared/package.json` was touched in this
revision — they still carry only their round-0 edits. This round did narrow
`DashboardTextFormat`, which the main barrel exports, so I re-checked exactly the
projects that failure mode would reach:

```
settings-core        OK      cli-agent-runtime    OK
task-specs           OK      platform-cli         OK
vscode-core          OK
```

Coverage re-checked, since both projects enforce thresholds in their `ci`
configuration and this round added code:

```
shared           Statements 94.57% (>=85)  Branches 86.88% (>=85)  Functions 79.58% (>=70)  Lines 95.07% (>=85)
vscode-lm-tools  Statements 82.90% (>=75)  Branches 67.68% (>=60)  Functions 87.48% (>=85)  Lines 83.45% (>=75)
```

### Still open for the reviewer

1. **Finding 1's renderer half is still TASK_2026_494's.** The channel is closed in the contract; a renderer that parses plain text anyway is a bug a shared lib cannot catch.
2. **The `$ref` risk from round 0 is unchanged.** Still the thing I am least confident about, and still worth one real tool-list check against a live MCP client.
3. **Delivery failure and partial delivery have no retry semantics.** The tool tells the caller how many surfaces landed and says to re-send rather than assume nothing arrived. Whether a re-send should reuse the same `revision` is a question for the pinning task, not this one.
4. **The structural pre-check duplicates the depth and count rules.** Deliberate and documented, but it is two places that must agree. Both read `DASHBOARD_LIMITS`, so a confirmed budget still moves in one place — but the two messages must stay worded alike, or a test asserting on wording will drift.

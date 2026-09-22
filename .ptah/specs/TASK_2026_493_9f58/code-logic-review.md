## Verdict

**ship after fixes**

Accepted markdown bypasses the URL policy, and an attached surface's delivery failure can leave the tool reporting success with an unhandled rejection. Fix those boundary failures, the timestamp length omission, and the recursive validator's stack overflow before shipping this contract to its renderer consumer.

| Metric | Result |
| --- | --- |
| Logic score | 4/10 |
| Assessment | NEEDS_REVISION |
| Blocking / serious / moderate | 2 / 1 / 1 |
| Confirmed failure modes | 4 |

The score reflects the security and delivery failures below, rather than lack of a renderer: validation rejects ordinary invalid specs before emission, but that happy path does not cover these failures. The five-kind catalog and existing validation flow do not require replacement.

## Findings

1. **Blocking — CONFIRMED: rich text is an alternate URL channel that bypasses the HTTPS allowlist.**

   **Evidence:** `libs/shared/src/mcp-apps-contracts/dashboard-spec.schemas.ts:78` validates rich-text content only as a bounded string; line 79 enables markdown. The explicit URL refinement at line 69 never examines that content. Nested list text uses the same rich-text schema at line 174. `libs/shared/src/mcp-apps-contracts/dashboard-spec.types.ts:37` directs markdown to the existing chokepoint, whose webview sanitizer explicitly permits `http:` and `data:` at `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:72`; its full preset installs that sanitizer at line 282.

   **Failure scenario:** in an otherwise valid envelope, set `title` to `{ "format": "markdown", "text": "![x](data:image/png;base64,AAAA)" }`, or use `![x](http://example.com/x.png)`. Both pass `validateDashboardSpec`. The same payloads pass under `components[0].items[0].text` in a list. Independently executing the installed `marked` parser and the actual full-preset sanitizer factory preserves `<img src="data:image/png;base64,AAAA">` and `<img src="http://example.com/x.png">`; a markdown `http:` link also survives. Raw `<img src="http://example.com/x.png">` inside markdown is another accepted spelling.

   **Impact:** a consumer following the prescribed markdown path can receive an active non-allowlisted image source/link, including a fetch outside the explicit URL channel. This contradicts `context.md:44`; it is a confirmed acceptance/policy bypass, not a claim that JavaScript executed or that a nonexistent dashboard renderer was exploited.

   **Fix:** close URL-bearing markdown and raw-HTML paths before accepting the spec, including links, images and reference destinations. Coordinate any dashboard-specific markdown policy with the existing chokepoint; do not add another markdown renderer. Sanitizing only the explicitly named `url` properties cannot enforce this contract.

2. **Blocking — CONFIRMED: broadcast delivery failure is discarded and can become an unhandled rejection after success.**

   **Evidence:** `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:852` executes `void webviewManager.broadcastMessage(type, payload)`. The namespace's dependency returns `void` at `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/dashboard-namespace.builder.ts:72`; it dispatches at line 119 and returns `accepted` at line 131. The dispatcher consequently returns success at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1643`. `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts:304` evaluates `view.webview.postMessage(...)` before attaching its `.catch`.

   **Failure scenario:** the spec is valid and an attached sidebar's `postMessage` throws, for example during disposal. Since `broadcastMessage` is async, the throw becomes a rejected promise; the new wrapper drops it. Replaying the actual `broadcastMessage` method with a throwing surface, the new namespace and its exact wrapper produced `delivery failure outcome accepted`, followed by `UNHANDLED: disposed during postMessage`.

   **Impact:** the caller sees successful dashboard emission even though delivery failed, and the rejection escapes the request error handler. Separately, ordinary rejected post promises are swallowed/logged by the manager at lines 304–314, so merely adding `await` would not establish delivery success for every failure mode. The intentionally absent-UI CLI case is not this finding.

   **Fix:** observe the asynchronous delivery operation and provide a delivery outcome for attached surfaces; do not return success for failed delivery. Keep validation rejection before dispatch and distinguish it from delivery failure, since some surfaces may already have received a whole payload.

3. **Serious — CONFIRMED: a small, deeply nested JSON spec overflows the stack before its depth budget is checked.**

   **Evidence:** `libs/shared/src/mcp-apps-contracts/dashboard-spec.validator.ts:110` runs the recursive Zod parse. Recursion enters children at `dashboard-spec.schemas.ts:212`; envelope component-count and depth checks execute only afterward at lines 428 and 437.

   **Failure scenario:** start with a valid minimal envelope and a stat `{id:"s",kind:"stat",value:1}`; append one stat child at each level, assigning ids `s1` through `s999`. The JSON-round-tripped envelope is **51,056 UTF-8 bytes**, below 262,144. The real `jsonUtf8Bytes` succeeds, but `validateDashboardSpec` throws `RangeError: Maximum call stack size exceeded` from Zod instead of returning its rejection union. Depth 9 and depth 200 return ordinary rejections; depth 1,000 reaches the exception first.

   **Impact:** the supposedly reusable boundary validator has an attacker-triggerable exception path for ordinary JSON, and its depth cap does not bound parsing recursion. The current MCP catch at `protocol-dispatcher.ts:1835` still produces `isError: true` with a generic stack-overflow reason, and no push occurs; I did not reproduce a process crash or an accepted over-depth spec.

   **Fix:** bound structural traversal before recursive parsing, or make recursive schema traversal stop at the allowed depth. Retain the Zod budget refinements and ensure the public validator returns a useful rejection for pathological trees.

4. **Moderate — CONFIRMED: `generatedAt` bypasses the universal string-length budget.**

   **Evidence:** `libs/shared/src/mcp-apps-contracts/dashboard-spec.schemas.ts:418` uses `z.iso.datetime({ offset: true })` without `.max(MAX_STRING)`. The universal 2,000-character limit is declared at `dashboard-catalog.ts:136` and line 148, and required by `context.md:25`.

   **Failure scenario:** replace a valid envelope's timestamp with `'2026-09-22T00:00:00.' + '1'.repeat(2001) + 'Z'`. Its length is 2,022 characters; validation returns `ok: true`. ISO fractional seconds permit this length, and the total byte cap does not enforce the per-string cap. The accepted string also enters the text fallback at `dashboard-text-fallback.ts:191`.

   **Impact:** an accepted spec violates a literal boundary budget and passes the oversized string to consumers.

   **Fix:** apply the shared string maximum to the ISO timestamp schema.

## Categories with no findings

- **Action allowlist and ordinary value shapes:** no additional confirmed executable/path/query sink. `dashboard-spec.schemas.ts:91` restricts action ids; lines 103–119 require `url` only for `dashboard.open-url`. Every fixed-shape object, including component union members, nested rich text, data refs, series points, columns and list items, is strict (lines 81, 102, 134, 142, 152, 161, 178, 246, 281, 286, 304, 331, 426, 467). `params` is intentionally a record with validated keys and scalar values at lines 95–100, not an unchecked nested object. Scalars may spell commands or URLs, and the slug alphabet at line 55 admits colon-bearing handles such as `javascript:1`; neither is an executable sink under the opaque-handle/host-mediation semantics at `dashboard-spec.types.ts:55` and line 71. No actual resolver is implemented here. Markdown's active interpretation is finding 1.
- **Explicit URL properties:** no non-HTTPS protocol bypass found in `dashboard-catalog.ts:177`. Probed case variants, leading whitespace/control characters, credentials including percent-encoded userinfo, backslashes, encoded and Unicode scheme spellings. Some spellings such as `\u0000https://example.com`, `ht\ttps://example.com` and `https:\\example.com` are accepted, but WHATWG parsing at line 185 still yields `https:`; that alone is not a forbidden-scheme exploit. Nested list `url` uses the same refinement at `dashboard-spec.schemas.ts:176`. Scalar table cells and opaque data references are not automatically links.
- **Validation ordering/atomicity:** outside delivery failure, no partial, duplicate, or rejected-spec emission found. The namespace validates at line 105, exits rejected at lines 107–116, and has exactly one broadcast site at line 119. An independently injected unknown version returned `rejected` with zero pushes. A synchronously throwing broadcast callback rejects the namespace promise; the dispatcher catch at line 1835 reports `isError: true`, rather than success.
- **Other budget measurements:** `dashboard-spec.validator.ts:99` counts bytes before Zod with the actual backend counter (`dashboard-namespace.builder.ts:105`; `libs/backend/platform-core/src/utils/json-budget.ts:44`). The parser does not inflate ordinary JSON with defaults or coercions. Component count includes descendants (`dashboard-spec.schemas.ts:373`), ids are checked across the tree (line 446), and chart points are summed across series (line 266). Row, column and point caps read `DASHBOARD_LIMITS`; the 20-row text-table cap is applied at `dashboard-text-fallback.ts:94`. Findings 3–4 are the exceptions.
- **Transport registration:** constant at `message-constants.ts:177`, payload-map registration at `payload-map.ts:366`, and `spec: DashboardSpecEnvelope` at line 235 agree. Optional `sessionId` explicitly means “not mine,” never “active session,” at lines 237–242. Repository search found generic uses of `keyof MessagePayloadMap`, not a broken exhaustive map. This producer adds a push message, not an RPC method. Namespace wiring is present at `ptah-api-builder.service.ts:835`, tool listing at `protocol-dispatcher.ts:303`, and calling at line 1619.
- **Current strictness containment:** no present type/schema field mismatch or new dashboard-schema path into the main barrel found. `libs/shared/src/index.ts:33` exports plain types; `payload-map.ts:129` imports the plain envelope. Independent no-emit compiler checks passed for shared, vscode-lm-tools, and settings-core; the latter's actual compiler program excludes `dashboard-spec.schemas.ts`.
- **Collateral diagnostics:** independently checked all 15 reported failing project configurations with the installed TypeScript compiler API, with emit and incremental writes disabled. None of their diagnostics named a file in the change's file inventory. Errors include the missing generated Prisma client at `libs/api/core/src/index.ts:5` and dependent missing Prisma members. This supports isolation from this change, but is not an untouched-baseline comparison.

The five logic questions, explicitly:

| Question | Answer |
| --- | --- |
| How does this fail silently? | Finding 2: delivery failure followed by accepted output (`ptah-api-builder.service.ts:852`). |
| What user action produces unexpected behaviour? | Submitting markdown containing a non-HTTPS image produces accepted active URL content (finding 1, `dashboard-spec.schemas.ts:78`). |
| What input produces a wrong answer? | The oversized fractional timestamp is wrongly accepted (finding 4, `dashboard-spec.schemas.ts:418`). |
| What happens when a dependency fails? | A synchronous callback throw propagates to the MCP error catch; the real async broadcast can escape observation (finding 2, `protocol-dispatcher.ts:1835`). |
| What is missing that the requirements never mentioned? | Failure semantics when one surface receives a spec and another fails are unspecified; the broadcast implementation can target multiple surfaces (`webview-manager.ts:299`). |

## What I could not check

- **Real MCP-client interoperability remains PLAUSIBLE, not a confirmed client defect.** I generated and inspected the actual `inputSchema` from `dashboard-propose-spec.tool.ts:44`. The root and envelope retain `type`, properties, required fields and closed-object rules; `spec.components.items` is only `{ "$ref": "#/definitions/DashboardComponent" }`, with a five-member `oneOf` under that definition. Children use the same reference. An Ajv probe rejects `{kind:"shell",command:"arbitrary"}` with references intact and accepts it after simulating an implementation that ignores `$ref`. Thus **component items become unconstrained for such a client; the entire input envelope does not become unconstrained**. The neighboring handwritten harness schema instead gives `configUpdates` an explicit `type: 'object'` at `tool-description.builder.ts:1577`. No actual Claude/Codex/Cursor/Copilot client was exercised. Backend Zod validation remains authoritative even if a client's schema handling is weaker.
- **The claimed bidirectional compile-time drift guarantee does not exist, although the current shapes agree.** Not every export has an individual `satisfies`: the URL, five component schemas and tool-input schema do not (`dashboard-spec.schemas.ts:66`, 237, 279, 284, 289, 319, 463). The union annotation at line 348 supplies a real one-way check. In-memory compiler probes on the actual source confirmed: removing required stat `value` fails there; adding a schema-only required `reviewerOnly: z.string()` passes; removing optional `unit` passes. `satisfies z.ZodType<T>` likewise checks assignability, not exact equality. The “field added to one and not the other fails” claim at `dashboard-spec.types.ts:23` should not be relied on. No source files were modified for these probes, and no hypothetical future mismatch is counted as a current runtime defect.
- **Renderer, final budget calibration and second-boundary verification:** the renderer does not exist, so the requested render test (`context.md:19`) and webview measurement (`context.md:32`) remain unverified. The provisional numbers are explicitly recorded at `dashboard-catalog.ts:125`. Markdown findings were reproduced through the current parser/sanitizer, without claiming a dashboard UI test. A future UI must still mediate actions and apply its boundary validation.
- **Verification limits:** the five new test files were inspected, but their complete Jest suites were not rerun. Evidence here comes from independent runtime probes, failure injection, generated-schema validation and no-emit compiler checks. `ptah_get_diagnostics` twice returned unavailable/still-running after 45 seconds, so direct compiler checks supplied the evidence. Ptah symbol search returned no hits for broadcast delivery, so native search was used. No untouched checkout, Prisma generation, full 94-project rerun, or live host delivery test was performed. The task folder had no separate task-description, implementation-plan or style-review document.

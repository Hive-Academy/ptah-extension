# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 4/10           |
| Assessment          | NEEDS_REVISION |
| Verdict             | REVISE         |
| Blocking issues     | 4              |
| Serious issues      | 0              |
| Moderate issues     | 0              |
| Failure modes found | 4              |

Batch 7, final independent r4 review under User Decision 13, 2026-09-26. Root: `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`.

The exact prior reproductions are corrected, and normal files retain the reported token savings. However, the completeness contract still fails: decorators, instance initialisers, implicit getter/coercion execution, and wholesale object-shape elision produce successful structural results with missing public members. These are independently reproduced below. Silent incorrect API answers keep the score below 5–6; passing scoped checks, honest ordinary refusals, preserved retained slices and measured savings keep it above 1–2.

Path abbreviations used throughout:

- **D**: `libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts`
- **S**: `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts`
- **N**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts`
- **T**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`

## r1 + r2 + r3 findings

Status here refers to the specific prior reproduction, not a claim that its broader failure class is impossible. R4-B1/B2/B3 demonstrate remaining runtime-publication variants.

| Prior finding                                                                        | Status | Independent evidence                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1-B1: TSX arrow components vanish                                                   | fixed  | Exact App/Next fixture: full/unsupported-language; explicit typescript: full/parse-failed; original text identical. N:120; S:176.                                                                                                       |
| R1-B2: ambient declarations vanish                                                   | fixed  | Exact declared greet fixture: full/summary-not-smaller, identical text. Interfaces/types/overloads retained by real-parser specs. D:160; S:198.                                                                                         |
| R2-B1: conditional, defineProperty and bracket CommonJS exports vanish               | fixed  | All three literal reproductions return identical full/unsupported-declarations. Prototype and exports-in-body regressions also pass. D:299, D:312.                                                                                      |
| R2-B2: retained template whitespace changes                                          | fixed  | Blank lines, whitespace-only lines and CRLF preserved byte-for-byte in structural output, 74→45 tokens. D:705, D:711.                                                                                                                   |
| R2-S1: huge direct literals crowd out tail API                                       | fixed  | 5,000-entry array/object probes reduce to 47 tokens with tailApi present; literal values are explicitly omitted. D:508. See R4-B4 for a separate remaining object-member completeness problem.                                          |
| R2-M1: quadratic renderer                                                            | fixed  | Shared monotonic cursor D:696; independent 2k/8k/16k render minimums 1.90/9.12/13.08 ms. Sorts and binary lookups remain; no declaration×body cross-product.                                                                            |
| R3-B1: exports aliases/destructuring/CJS this/globalThis/prototype/IIFE installation | fixed  | All six exact generators return full/unsupported-declarations, identical content; token counts 69/73/68/65/73/71 respectively. D:299, D:312, D:327, D:516. The broader “all runtime publication refused” claim still fails R4-B1/B2/B3. |
| R3-B2: reference-valued methods/spread/computed keys lost in large object            | fixed  | CommonJS, ESM reference and spread/computed variants return identical full/unsupported-declarations. D:505; D:581.                                                                                                                      |
| R3-S1: wrapped/mixed literals consume inline budget                                  | fixed  | Exact wrapped array: structural, 19,088→54 tokens, tailApi retained. Exact method-plus-data object: identical full/unsupported-declarations, 19,092 tokens. D:513, D:543.                                                               |
| R3-M1: fewer characters but more tokens                                              | fixed  | Exact 350-space fixture: identical full/summary-not-smaller, 14→14 real gpt-tokenizer tokens. S:198.                                                                                                                                    |

The wrapped R3-S1 case correctly returns a small complete structural result, not full content. This agrees with the implemented pure-data exception and the executor's explicit account; requiring full mode for that case would be stricter than the “complete summary OR honest refusal” acceptance rule.

## Five logic questions

### 1. How does this fail silently?

The service accepts the writer's summary at S:210 without an API-completeness check beyond its syntactic gates. A decorator-installer's publicApi, an instance-installer's publicMethod, and getter/coercion-installed publicApi are missing from successful structural results (D:116, D:324, D:106). Large pure-data objects lose named public properties at D:508. None of these results has a fallback reason.

### 2. What user action produces unexpected behaviour?

Enrich an ordinary decorated plugin module, a JavaScript client class initialised by an installer/factory, or a configuration module with lazy getters or string coercion. Callers receive an API view missing members that exist when the module loads or the exported class is constructed. Real runtime verification is recorded under R4-B1/B2/B3. An exported configuration object loses its readable property names once its literal exceeds 400 characters (R4-B4; D:502).

### 3. What input data produces a wrong answer?

The exact generators below produce incomplete answers rather than errors. All use valid parser input and beneficial token reductions, so neither syntax recovery nor summary-not-smaller masks the defect. Small getter objects are below 400 characters, bypassing the large-literal purity guard at D:502; the omitted installer bodies contain the missing names.

### 4. What happens when a dependency fails?

A failed read returns empty full/read-failed (S:129). Parser Result.err and recovered syntax return original text with parse-failed (S:164, S:176); unsupported language skips parsing (S:155). The scoped suite exercises these paths and passed. queryMulti releases queries/tree in finally at `libs/backend/workspace-intelligence/src/ast/tree-sitter-parser.service.ts:655`.

Unexpected pipeline throws are broadly labelled read-failed by N:159, including an error comment rather than file content. This existing classification is not a newly reproduced defect here. No timeout/cancellation or resource-leak claim is inferred without evidence.

### 5. What is missing that the requirements never mentioned?

“Deferred until instance construction” does not mean irrelevant to the public instance API (D:324). Decorators are executable at definition time (D:116). Property access and coercion can invoke elided bodies without call_expression nodes (D:106). Finally, pure data can still have a public named shape (D:508). Preserving callable and readable members requires accounting for these distinctions or refusing.

## Failure modes

The following generator fragments were run through this worktree's real namespace, service, queryMulti, grammar and writer with installed gpt-tokenizer. Padding only ensures the savings gate cannot conceal a defect:

```javascript
const pad = 'const padding = "' + 'x'.repeat(350) + '";';
const work = 'export function work(input: string) { ' + pad + ' return input; }';
```

### R4-B1 — Decorators execute an elided API installer

- Trigger: a local decorator or decorator factory mutates an exported registry.
- Symptom: structural result drops publicApi entirely; runtime exposes a callable api.publicApi immediately after module evaluation.
- Evidence: D:116 marks every decorator deferred; D:323 exempts it from load-time refusal; D:71 elides the named function body; S:210 reports structural success.
- Current handling: syntactic decorator presence is treated as safe regardless of the decorator's behaviour.
- Recommendation: refuse decorators whose behaviour cannot be proven declaration-only. A blanket decorator refusal is safe under Decision 13; do not infer purity from their prevalence.

Exact typed reproduction (.ts):

```javascript
const source = 'export const api: Record<string, (x:number)=>number> = {}; ' + 'function register(target: Function) { api.publicApi = x => x; ' + pad + ' } @register export class Plugin {}';
```

Actual result: structural, **87→53 tokens**, no reason. Kept declarations are api's empty object, `function register(target: Function);`, and the decorated Plugin class. The text contains no publicApi. Executing TypeScript's transpiled output with experimentalDecorators in an isolated VM yields `typeof exports.api.publicApi === "function"`.

A decorator factory `@register()` also reproduces the loss (80→41 tokens in the unannotated fixture). A decorator imported from another module need not reveal that module's implementation; this finding instead concerns an installer and public registry defined entirely in the file being summarised. It is a real ordinary plugin-registration pattern, not an acceptable documented edge.

### R4-B2 — Instance initialisers hide the public instance API

- Trigger: an exported class initialises itself through a local installer, or an instance field receives an object returned by a local factory.
- Symptom: constructing the class exposes callable members absent from the structural result.
- Evidence: D:324 exempts every non-static field value; D:71 removes local installer/factory bodies; D:531 judges literal size but does not establish the shape of call-valued instance fields.
- Current handling: an initializer's execution being deferred until construction exempts it even when it constructs public members.
- Recommendation: refuse call/new/other unresolved instance initializer expressions when their public shape is not represented; preserve safe declared fields and arrow signatures.

Exact JavaScript reproduction (.js):

```javascript
const source = 'function install(target) { target.publicMethod = x => x; ' + pad + ' } export class Client { ready = install(this); }';
```

Actual result: structural, **74→40 tokens**, containing only `function install(target);` and `export class Client { ready = install(this); }`. Runtime: `typeof new exports.Client().publicMethod === "function"`.

Independent factory variant:

```javascript
const source = 'function makeApi() { ' + pad + ' return { publicMethod(x) { return x; } }; } ' + 'export class Client { api = makeApi(); }';
```

Structural, **78→40 tokens**; `new Client().api.publicMethod` is callable, but publicMethod is absent. Ordinary construction is enough; no external mutation, prototype trick or malformed input is needed. This exemption is not safe under the requested publicly-reachable-member contract.

### R4-B3 — Implicit getter/coercion execution bypasses the load-time gate

- Trigger: a retained small literal reads a getter or interpolates an object whose method publishes API.
- Symptom: publicApi is callable at module completion but absent from structural output.
- Evidence: D:106 enumerates calls/new/await/spread/computed keys/static blocks, not property reads or template coercion; D:502 accepts small literal values without purity checks; D:74 elides getter/toString method bodies.
- Current handling: retaining the small literal expression does not retain the invoked method body that installs API.
- Recommendation: refuse unresolved accessor reads/coercions at load time, or conservatively refuse small non-pure-data initializers that can invoke elided code. Size is not an execution-safety test.

Exact getter reproduction (.ts; work supplies harmless size padding):

```javascript
const source = 'export const api = {}; ' + 'const trigger = { get ready() { api.publicApi = x => x; return true; } }; ' + 'export const state = {ready: trigger.ready}; ' + work;
```

Actual: structural, **98→59 tokens**; getter body becomes `{ … }`, and publicApi disappears. Runtime: `typeof exports.api.publicApi === "function"`.

Coercion variant:

```javascript
const source = 'export const api = {}; ' + 'const trigger = { toString() { api.publicApi = x => x; return "ok"; } }; ' + 'export const label = `' + '${trigger}' + '`; ' + work;
```

Actual: structural, **97→56 tokens**, same missing callable API. The trigger literal is small in both cases. These are deterministic, ordinary JavaScript execution mechanisms. Documenting them in the executor report does not make a reason-less structural response honest.

### R4-B4 — Pure-data object elision removes named public properties

- Trigger: an exported object has a named readable member and enough literal data to exceed 400 characters.
- Symptom: the entire object becomes `{ … }`; even its property names vanish.
- Evidence: D:502 tests size; D:505 accepts pure data; D:508 elides the entire object; D:266 supplies a replacement with no keys.
- Current handling: purity protects against losing function references but does not preserve data-member API shape.
- Recommendation: retain named object members and elide only bulky values, or return full/unsupported-declarations when the shape cannot be retained.

Exact reproduction:

```javascript
const source = 'export const settings = { publicSetting: "value", payload:"' + 'x'.repeat(450) + '"}; ' + work;
```

Actual: structural, **134→40 tokens**, with `export const settings = { … };`; publicSetting appears nowhere. Runtime: `typeof exports.settings.publicSetting === "string"`.

This is distinct from approved omission of a large string/array's payload: publicSetting is a named property used by consumers. Decision 13 permits omitting pure-data literal values, but the requested “no exported/publicly reachable name or member disappears” criterion still requires this object's named shape. Literal purity alone does not satisfy it.

## Blocking issues

### R4-B1 — Decorator-installed exports omitted

- File: D:116, D:323.
- Scenario: local registry decorator executes while defining an exported class.
- Impact: the agent sees a successful API summary that omits a real callable registry member.
- Fix: conservative decorator refusal unless the represented API remains complete.

### R4-B2 — Instance-installed members omitted

- File: D:324, D:531.
- Scenario: local installer/factory in an exported class field.
- Impact: the agent cannot discover a usable member on normal constructed instances.
- Fix: refuse unresolved initializer-produced API or preserve its declared shape.

### R4-B3 — Getter/coercion-installed exports omitted

- File: D:106, D:502, D:74.
- Scenario: property access/template interpolation executes an elided publisher.
- Impact: successful summary omits a member already available after module loading.
- Fix: conservative purity checks for small load-time literals and implicit invocation paths.

### R4-B4 — Named data members omitted

- File: D:508, D:266.
- Scenario: large exported pure-data configuration object.
- Impact: readable public property names disappear from the API view.
- Fix: member-preserving value elision or honest full refusal.

## Serious issues

None separately reproduced.

## Moderate and minor issues

None counted. Safe false-positive refusals are allowed. No style/naming finding is duplicated.

## Data flow

1. Dispatcher validates a nonblank file and serialises the result — OK: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1939`.
2. Namespace resolves path and explicit/inferred language — OK: N:112, N:151; .tsx safely refused.
3. Service reads once or accepts supplied content — OK: S:123; identifiable read/parse/language failures.
4. Real queryMulti collects error, declaration, body, literal, load-time and runtime-reference captures — OK for tested syntax: S:161; parser cleanup at tree-sitter-parser.service.ts:655.
5. Top-level and runtime-channel refusal — exact earlier fixtures fixed: D:299, D:312.
6. Deferred/load-time classification — R4-B1/B2/B3: D:321.
7. Literal abstraction — R4-B4: D:508.
8. Sorted rendering copies retained slices — OK in byte-identity probes: D:690.
9. Character early rejection and token comparison — OK for nonempty inputs: S:191, S:198.
10. Structural envelope exposes the gaps without a reason — S:210. Metadata remains ahead of content at S:229 / N:165.
11. The context optimiser can consume the same incomplete summary as an override — `libs/backend/workspace-intelligence/src/context-analysis/context-size-optimizer.service.ts:314`, :332. Its token budget is charged before selection; no budget bypass found.

## Requirements fulfilment

| Requirement                                      | Status   | Gap                                                                                 |
| ------------------------------------------------ | -------- | ----------------------------------------------------------------------------------- |
| Explicit supported hint and extension inference  | COMPLETE | Safe .tsx fallback retained                                                         |
| Exact r1/r2/r3 regressions                       | COMPLETE | Results above; broader completeness still fails                                     |
| Only complete API summary or honest full refusal | PARTIAL  | R4-B1/B2/B3/B4                                                                      |
| Runtime-publication refusal                      | PARTIAL  | Decorator, instance and implicit invocation paths                                   |
| Retained source slices byte-identical            | COMPLETE | Blank lines/whitespace/CRLF probe; D:705                                            |
| Scalable rendering                               | COMPLETE | Monotonic sweep plus sorts; measured below                                          |
| Token-based not-smaller gate                     | COMPLETE | Exact R3-M1 fixed; existing empty-file header special case remains                  |
| Normal declaration-file token savings            | COMPLETE | Independent 48%, 57%, 64%                                                           |
| Fixed degradation logs; audit baseline           | COMPLETE | S:130, :165, :177, :184, :199; audit passes                                         |
| Truthful tool description                        | PARTIAL  | T:1632 promises API surface and declaration-only safety contradicted by R4 findings |

Implicit requirements not addressed: public instance construction, implicit invocation, and named data-member shape. The description correctly lists inference, fallback reasons and token comparison, but its completeness promise is not established. No separate description-only issue is counted.

## Edge cases

| Case                                              | Handled                  | How                                                    | Concern                                     |
| ------------------------------------------------- | ------------------------ | ------------------------------------------------------ | ------------------------------------------- |
| TSX inference / explicit TS                       | YES                      | unsupported-language / parse-failed with original text | Structural TSX remains unavailable          |
| Ambient declarations and export as namespace      | YES                      | Original content, summary-not-smaller                  | No missing name                             |
| Named re-export, export-star, namespace re-export | YES                      | Exact clauses retained                                 | Does not resolve another file's contents    |
| export = API                                      | YES                      | Function signature and export assignment retained      | Tested structural result                    |
| Function/namespace declaration merging            | YES                      | API and namespace publicMethod both retained           | Tested structural result                    |
| Namespace runtime call                            | YES                      | full/unsupported-declarations                          | Original source preserved                   |
| Computed enum member invoking a function          | YES                      | full/unsupported-declarations                          | Safe refusal                                |
| Class arrow field                                 | YES                      | Field name/parameters retained                         | Body intentionally elided                   |
| Local decorator / decorator factory               | NO                       | Structural with missing member                         | R4-B1                                       |
| Instance installer / factory                      | NO                       | Structural with missing member                         | R4-B2                                       |
| Small getter and template coercion                | NO                       | Structural with missing member                         | R4-B3                                       |
| Large pure-data object                            | NO for named shape       | Whole object elided                                    | R4-B4                                       |
| Large wrapped pure-data array                     | YES                      | 54-token summary with tailApi                          | Explicit payload omission                   |
| Object mixing methods and large data              | YES                      | full/unsupported-declarations                          | Refusal is allowed                          |
| Empty file                                        | YES as existing contract | Structural empty-file header                           | Existing exception to savings gate, not new |
| Very many declarations                            | YES in probe             | Sweep plus sorts                                       | No hard latency guarantee                   |
| Read failure / parser error                       | YES                      | Distinct fallback reasons                              | Suite covers boundaries                     |

## Verification evidence and limits

- Requested `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache`: **all six targets passed**, 54.1 seconds. No port EACCES.
- Requested `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: **passed**, 11.6 seconds, 300 unsuppressed sites. Baselines remain vscode-lm-tools 2 and workspace-intelligence 1 (`tools/degradation-audit/baseline.json:35`, :36).
- Scoped ptah_get_diagnostics: typescript-compiler, zero errors/warnings.
- In-memory probes transpiled worktree source with TypeScript and used the actual namespace/service/parser/writer and installed WASM grammars. DI decorators, logging, Result/platform boundaries and fixture reads were shimmed; counts used installed gpt-tokenizer. The extension-map boundary mirrored TS/JS entries. No probe/spec/source file was written.
- Runtime proof executed only constructed fixtures in isolated Node VM contexts; TypeScript transpilation used CommonJS and experimentalDecorators. Actual members were checked after module evaluation or instance construction, not inferred solely from source.
- These probes stop at the namespace envelope; no live MCP transport or new budget/spool simulation was run. Dispatcher serialization was inspected; prior budget/spool evidence was read. The reproduced summaries are tiny and do not involve truncation.
- Changed degradation messages are fixed text or a closed reason union (S:184). The pre-existing empty-file debug log includes the path (S:138); it is not a new degradation branch.
- ptah_search_files returned no AGENTS.md; native hidden-file discovery also found no AGENTS.md/CLAUDE.md. No task-description.md, implementation-plan.md or code-style-review.md exists in this task folder. Context Decision 13, Batch 7, all executor-report sections and the three prior reviews supplied intent. No read/search AST tool was available for literal whole-file reads; native reads were used.
- No git operations were performed under the reviewer role restriction; therefore git status/diff and branch identity were not independently verified. Scope follows the named files in the requested worktree. No raw .jsonl/.sqlite session logs were read.
- Only this deliverable was intentionally written. Host boots and cross-process transport lifecycle were not tested. No additional defect is inferred from those omissions.

Normal-file measurements, including summary headers:

| File                                                                          | Mode / reason                   | Original tokens | Returned tokens | Reduction |
| ----------------------------------------------------------------------------- | ------------------------------- | --------------: | --------------: | --------: |
| workspace-intelligence/src/context-analysis/context-enrichment.service.ts     | structural                      |           2,567 |           1,343 |       48% |
| workspace-intelligence/src/context-analysis/context-size-optimizer.service.ts | structural                      |           3,397 |           1,445 |       57% |
| workspace-intelligence/src/ast/tree-sitter-parser.service.ts                  | structural                      |           6,683 |           2,411 |       64% |
| vscode-lm-tools/.../tool-description.builder.ts                               | full / unsupported-declarations |          16,366 |          16,366 |        0% |
| workspace-intelligence/.../declaration-summary.ts                             | full / unsupported-declarations |           5,842 |           5,842 |        0% |

Renderer-only minimum of three runs on real captures: 2,000 functions 1.90 ms; 8,000 functions 9.12 ms; 16,000 functions 13.08 ms. Parsing/tokenization excluded. This corroborates removal of the former quadratic renderer, not strictly O(n) total processing: sorting and binary searches remain (D:581, D:628, D:675).

## Verdict

- Recommendation: **REVISE**
- Confidence: **HIGH** for the four reproduced failure modes.
- Top risk: the tool returns successful structural API views missing members available in normal module/instance use.
- What a robust implementation would add: conservative refusal of unsafe decorators, unresolved instance initializers and implicit load-time invocations; preservation of object member names while eliding values; real-parser/runtime regressions for the fixtures above.

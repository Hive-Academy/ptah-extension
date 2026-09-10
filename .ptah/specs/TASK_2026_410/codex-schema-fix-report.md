# Codex auth proxy schema fix report

Date: 2026-09-10  
Scope: Codex Responses request translation and associated tests only.

## Outcome

Fixed the Codex auth proxy so Anthropic tool schemas retain their original
optional-property semantics at the final OpenAI Responses API boundary.
Translated function tools now send `strict: false` explicitly. The translator
does not add to, remove from, or otherwise rewrite each schema's `required`
array, and response translation does not add omitted tool arguments or remove
explicit ones.

No worktree-hook-handler file, existing worktree, git configuration, build,
package, dependency, commit, or push was touched.

## Established cause

The full local request path is:

1. Claude Agent SDK sends an Anthropic Messages request containing tool
   `input_schema` values to Ptah's local translation proxy.
2. `TranslationProxyBase` selects the Responses path for Codex and calls
   `translateAnthropicToResponses`.
3. `translateToolsForResponses` copies `input_schema` to the outgoing
   Responses function tool's `parameters` unchanged.
4. `TranslationProxyBase.forwardToResponsesApi` serializes that translated
   object directly into the upstream HTTP request body.

Before this fix, the outgoing function tool omitted `strict`. OpenAI's official
Responses API reference documents `strict` as defaulting to `true`. That differs
from the Chat Completions function-tool default (`false`). Strict Structured
Outputs requires every object property to be listed in `required`; optionality
must otherwise be modeled with nullable values. The Claude Agent SDK schema
uses ordinary JSON Schema optionality: `isolation` exists in `properties` but is
absent from `required`. Allowing Responses to default to strict therefore
changed the meaning of the schema at the provider boundary and exposed the
optional enum as required.

This establishes the previously hypothetical strict-default cause without
requiring a paid request. The owner is the Responses request translator: it is
the layer that converts an Anthropic tool definition into a Responses function
tool and previously failed to state the validation mode needed to preserve the
source contract.

## Sources

- OpenAI Responses API reference, function tool `strict`: default `true`:
  <https://platform.openai.com/docs/api-reference/responses-streaming?lang=python>
- OpenAI Chat Completions API reference, function tool `strict`: optional and
  defaults to `false`:
  <https://platform.openai.com/docs/api-reference/chat/message-list?lang=ruby>
- Installed Claude Agent SDK declaration inspected in the prior investigation:
  `node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts` declares
  `isolation?: "worktree"`.
- Prior repository trace:
  `.claude-worktrees/task-410-background-agent-execution/.ptah/specs/TASK_2026_410/worktree-spawn-investigation.md`.

## Files changed

- `libs/backend/auth-providers/src/lib/translation/responses-request-translator.ts`
  - Added `strict: false` to the Responses function-tool contract and emitted
    value.
- `libs/backend/auth-providers/src/lib/translation/responses-request-translator.spec.ts`
  - Updated the existing request shape expectations.
  - Added a two-tool regression proving `Agent.isolation` and an unrelated
    tool's `limit` stay optional while declared required arguments stay
    required.
- `libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.spec.ts`
  - Added mocked HTTPS boundary tests that inspect the final serialized Codex
    request.
  - Round-tripped an Agent call with omitted isolation and one with explicit
    `isolation: "worktree"`.

## Regression guarantees

The tests now assert all requested behavior:

- Final mocked outbound Codex request contains `strict: false`.
- Final outbound Agent schema keeps `required: ["description", "prompt"]` and
  does not add `isolation`.
- Inbound Agent arguments with omitted isolation remain omitted.
- Explicit `isolation: "worktree"` remains explicit and unchanged.
- Required arguments remain required.
- A second tool's unrelated optional `limit` property remains optional.
- The translator does not silently strip any explicit isolation value.

## Test evidence

Focused direct runs:

1. `npx jest --config libs/backend/auth-providers/jest.config.ts --runTestsByPath libs/backend/auth-providers/src/lib/translation/responses-request-translator.spec.ts --runInBand`
   - 1 suite passed; 14 tests passed; 1 snapshot passed.
2. `npx jest --config libs/backend/auth-providers/jest.config.ts --runTestsByPath libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.spec.ts --runInBand`
   - 1 suite passed; 9 tests passed; 0 snapshots.

Total intended focused verification: **2 suites, 23 tests, all passed**.

An initial Nx invocation with two paths forwarded only the Codex spec: 1 suite,
9 tests passed. A follow-up Nx invocation intended for one path discarded the
path filter and ran the entire `@ptah-extension/auth-providers` library: 37
suites, 669 tests, and 2 snapshots passed. Direct Jest invocations above were
then used to obtain unambiguous focused results. All runs emitted the existing
non-fatal warning about loading the TypeScript Jest config as an ES module.

`git diff --check` passed. Per task constraints, no build, packaging, install,
full-workspace test, Nx reset, or live paid provider request was run.

## Uncertainties and residual scope

- No live Codex request was sent. The regression proves the exact serialized
  body at Ptah's HTTPS boundary and relies on the provider's documented strict
  default.
- The separate WorktreeCreate hook behavior is outside this authorized change
  and was not modified.
- Version skew between the pinned Agent SDK and a separately detected Claude
  Code executable remains outside this focused fix. It does not alter the
  established strict-default defect in Ptah's outgoing Responses request.

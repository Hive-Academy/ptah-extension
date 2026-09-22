# Review record — TASK_2026_525 + TASK_2026_526

**This is not an independent review.** An `opencode` lane was spawned as the
disinterested reviewer — the only CLI family that wrote none of this code — and
was stopped after 45 minutes having written no deliverable. Its output showed
genuine work (39 tool calls, "drafting the review now while tests run"), but it
produced nothing usable. Scope was too wide for the slowest lane available.

What follows is the orchestrator's own verification. It is a weaker signal than
a different family would have been, and it is recorded as such.

## Defects found and fixed during review

| # | Defect | Where | Severity |
| - | ------ | ----- | -------- |
| 1 | All 97 models shipped `supportsToolUse: false` as "unverified". `fetchModels` filters on that flag, so any `toolUseOnly` caller saw an EMPTY OpenCode catalogue — on a gateway that sells nothing but coding models. Measured evidence existed: 103/103 models report `capabilities.tools: true` on `GET /api/model`. Latent, not live: no in-repo caller passes `toolUseOnly: true` today. | `opencode-provider-entry.ts` | medium |
| 2 | A spec asserted `fetchModels(id, key, true)` returns `{ models: [] }` — pinning defect 1 as intended behaviour. A test that encodes the bug is worse than no test. Now asserts the whole catalogue. | `provider-models.opencode.spec.ts` | medium |
| 3 | `LocalModelTranslationProxy` (Ollama, LM Studio) is a SIXTH `TranslationProxyBase` subclass that the plan's file list missed. It overrides nothing, so its lane is the base default. Old default `false` and new default `'chat/completions'` agree — by luck, not contract. Pinned. | `translation-proxy-base.spec.ts` | low |
| 4 | Exhaustiveness tripwire left red. `auth-strategy.types.spec.ts` deliberately fails when a provider ships without an explicit auth-routing decision. The batch correctly refused to edit outside its boundary; the routing decision was the orchestrator's to make. | `auth-strategy.types.spec.ts` | low |
| 5 | Lint error: an async generator mock with no `yield` (`require-yield`). | `ptah-cli-registry-opencode-proxy.spec.ts` | low |

## Checked and clean

**Lane migration (the approved blast radius).** `shouldUseResponsesApi` is gone
from the entire repo — no alias, no shim. All six subclasses enumerated; five
override the new hook, the sixth pinned to the default. The pins extend the REAL
proxy classes and call the production hook through the prototype, so they pin
production behaviour rather than a stub. Codex's forced-SSE endpoint match is
pinned too, unasked.

**Strategy refactor (five live providers).** Read the pins directly rather than
trusting the batch report. `openrouter`/`sakana`: `start` called exactly once,
correct placeholder token, empty `ANTHROPIC_API_KEY`, real key to
`switchActiveProvider`, and Zen/Go proxies asserted NOT started.
`moonshot`/`z-ai`/`requesty`: `requiresProxy !== true` checked against the live
registry, native base URL, provider-specific auth var, and all four proxies plus
the custom factory asserted untouched.

**Routing.** `minimax-m3` resolves to `chat/completions` under Zen and `messages`
under Go — the id collision that a model-only lookup would misroute. Zero
`gemini` or `jev-` references anywhere in the table. Counts match
`research-report.md` exactly: Zen 16/22/28, Go 8/18/5.

**Tier alias ordering.** `normalizeModelId` runs at
`translation-proxy-base.ts:381` and `resolveUpstreamProtocol` at `:387`, so the
lane is resolved from the NORMALISED id. Reversed, every `sonnet`/`opus`/`haiku`
request would 400. All six tier targets exist in their own subscription's table.

**Secrets.** No `process.env` reads in the new code. The factory spec asserts
each proxy's `Authorization` carries only its own key, that endpoints differ,
that lifecycles are independent, and that no key reaches any log call.

**Retry safety.** Specs assert call counts, so "retries exactly once", "never
loops" and "does not retry on spawn error or non-zero exit" are pinned, not
merely claimed.

**Blast radius beyond the edited projects.** `auth-providers/src/index.ts` and
the tokens barrel are imported by ten projects. `typecheck` green across
`rpc-handlers`, `agent-sdk`, `cli-engine`, `output-styles` and all three hosts
(`ptah-electron`, `ptah-extension-vscode`, `ptah-cli`). This matters because the
DI registration changed — a break would surface at host boot, not in a lib suite.

**Full suites, cache skipped.** `typecheck`, `test`, `lint` green on `shared`,
`auth-providers`, `cli-agent-runtime`, `chat`.

## Not checked

- **Live credentialed requests.** No Zen or Go API key was available. Endpoint
  shapes and routing are verified against vendor docs and a live `/api/model`
  probe; no actual inference request was ever made. **First real use should be
  treated as the true integration test.**
- **An independent reviewer's opinion.** See the note at the top.
- **The deferred frontend surface.** Not written, by design — see `follow-up.md`.

# Orchestration patterns

Three small generic helpers for generation workflows. All use the `Result` type from
`@ptah-extension/shared`. They are exported from the library index (`./index.ts`) and covered by
`patterns.spec.ts`; no other library imports them today.

| Export | File | Use |
| --- | --- | --- |
| `generateWithPartialSuccess` | `error-accumulation.ts` | Run a task per item and collect successes and failures instead of stopping at the first error. |
| `GenerationPipeline` | `generation-pipeline.ts` | Compose sequential phases that pass a context along, fail fast, and report which phase failed. |
| `PromptBuilder`, `BasePromptBuilder` | `prompt-builder.ts` | Build structured LLM prompts from a context. |

Read the source for signatures and the spec for usage.

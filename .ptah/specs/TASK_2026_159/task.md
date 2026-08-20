---
id: TASK_2026_159
status: in_review
type: BUGFIX
title: Curator model picker should default to active provider haiku tier
description: Stop hardcoding claude-haiku-4-5-20251001 as the curator fallback; resolve the haiku tier from the active auth provider's tier mapping.
assignee:
depends_on: []
executor:
claim:
created: 2026-07-16T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

The Memory Curator model picker currently labels its default as `Default (claude-haiku-4-5-20251001)` and the backend curator LLM adapter (`SdkInternalQueryCuratorLlm`) falls back to the hardcoded model ID `claude-haiku-4-5-20251001` whenever `memory.curatorModel` is unset.

This is incorrect when the user has settled on a non-Anthropic provider such as Ollama Cloud. The curator should instead resolve the **haiku tier** from the active auth provider's model-tier mapping (or from a specifically chosen curator provider), exactly the same way the main chat agent resolves its tier models.

This task updates the curator model resolution so that:

1. When no explicit curator model is configured, the curator uses the active provider's haiku-tier model.
2. When a specific curator provider is selected in the UI, it uses that provider's haiku-tier model.
3. The UI default label no longer implies Claude Haiku for every provider.
4. Switching/changing model tiers does not break curator auth or model resolution.

See `context.md` for the full conversation background and discovered code locations.

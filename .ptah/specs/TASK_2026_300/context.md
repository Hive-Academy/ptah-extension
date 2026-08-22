# Context

## Where this came from

An observation worth stating plainly: **every coding agent on the market answers
in text.** Claude Code, Codex CLI, opencode and the rest are TTY-bound and
structurally cannot do otherwise. Cursor and Copilot have real UI but their agent
output is still a markdown pane. A response is prose, and prose is a lossy
flattening of structure the model already had — a comparison it held as a table,
a result set it held as a list of locations.

Ptah is not a terminal. It has an Angular webview, a tile canvas, a streaming
router, and 52 components in `libs/frontend/chat-ui`. It has the substrate to do
better and currently does not.

## The rejected alternative — do not re-open without new information

The obvious move is to give the agent tools that emit components
(`respond_comparison({...})` and friends, rendered as a component instead of a
tool row). It was evaluated in full and **declined**. Recorded here so the
question is not re-derived from scratch:

- **Tool definitions are a per-request tax.** Roughly 150-400 tokens each, in
  every request, for the life of the session. Ten of them is ~2-4k tokens
  standing on top of an already-large harness (core prompt, enhanced prompts,
  skill catalogue, MCP docs) and the MCP tool surface. The deferred-tool
  mechanism exists precisely because that surface already got too big to load
  eagerly.
- **Output tokens go UP, not down.** Markdown is an unusually efficient
  serialization — part of why models emit it. A 4x4 comparison table is ~150
  tokens of markdown and ~250-350 as JSON tool args with keys repeated per row.
  Components are roughly 1.5-2x more expensive to emit and correspondingly
  slower to stream.
- **Attention cost, which is the real objection.** Every tool in context is a
  thing the model considers. Presentation tools in a coding agent create a
  specific failure mode: the model satisfies its completion instinct by
  producing a well-rendered artifact instead of doing the work. A good-looking
  comparison matrix _feels_ like a finished answer.

The discriminator that survives the analysis: **does a component enable an
interaction prose cannot, or does it only look better?** Read-only presentation
loses to markdown on tokens, latency, and reliability. Only surfaces that capture
input or replace a round trip pay for themselves — and those are rare enough to
be handled case by case, session-scoped, if they ever prove necessary.

That leaves the version worth building, which touches the agent not at all.

## The mechanism already exists

`libs/frontend/markdown/src/lib/marked-extensions.ts` already ships five
extensions — callout cards, code-block headers, decorative dividers, enhanced
headings, list cards — wired through `MARKED_EXTENSIONS` by
`provideMarkdownRendering()`. Upgrading recognized patterns in agent output is
**the established pattern in this lib**, not a new capability.

Properties that make this the right shape:

- **Zero agent cost.** No tool definitions, no extra output tokens, no attention
  budget, no prompt-harness pressure to maintain.
- **Zero regression risk.** Unrecognized markdown renders exactly as it does
  today. There is no path where the agent "fails to use the feature correctly".
- **Retroactive.** It improves every session already in history, with no
  re-run.
- **Vendor-agnostic.** It improves output from CLI-lane participants (Codex,
  Copilot, Cursor, …) that will never call a Ptah tool. Given TASK_2026_298's
  finding about fidelity asymmetry between lanes, this is the one rendering
  improvement that reaches every participant equally.

## Two hard design constraints

### 1. Extensions emit HTML strings; DOMPurify strips every event handler

`provide-markdown-rendering.ts` `createPermissiveSanitizer()` puts `onclick`,
`onerror`, `onload` and every other common handler in `FORBID_ATTR`. A marked
extension cannot emit an interactive element directly, and it cannot instantiate
an Angular component.

**The design is event delegation over `data-*` attributes.** The extension emits
something like `<span data-ptah-file="..." data-ptah-line="...">`; a host
listener on `MarkdownBlockComponent` catches clicks and resolves the action.
`ALLOW_DATA_ATTR: true` is already set (the existing extensions depend on it), so
this needs **no sanitizer change** — which matters, because guideline 2 of that
lib forbids relaxing `FORBID_TAGS` / `FORBID_ATTR` without a security review.

Consequence worth naming rather than discovering later: `MarkdownBlockComponent`
is currently pure — two inputs, no outputs, no host listeners, deterministic
given its input. Delegation gives it behaviour and probably an output. That is a
real change to the component's character and should be a deliberate decision, not
a side effect.

Dynamic component hydration (scanning rendered DOM and instantiating components
via `ViewContainerRef`) is the alternative and is heavier — it breaks the
component's OnPush purity, complicates teardown, and buys little over delegation
for the candidates below. Prefer delegation; justify in writing if a candidate
genuinely needs hydration.

### 2. The chokepoint is shared with the web product

`markdown-block.component.ts` states it: _"This is the ONLY markdown renderer in
the web tree. Every body — AI output, forum post, lesson comment — goes through
it."_ `libs/web/members` consumes it for forum and lesson content.

A `path:line` in a forum post must **not** become a clickable editor link. There
is no editor there; it would be a broken affordance in the member panel.

The lever already exists: `provideMarkdownRendering(config)` takes `'full'`
(webview) or `'basic'` (landing page). **Every enrichment in this task is gated
on `'full'`.** Enumerate the actual consumers of each preset before wiring, since
the member panel's choice determines whether the gate is sufficient or a third
preset is needed.

## Candidate enrichments, ranked

1. **File references → clickable.** Highest value by a wide margin. Coding-agent
   output is saturated with `path:line`, and this repo's own convention states
   the form is meant to be clickable. `file-path-link` already exists as an atom
   for tool output; the same reference in prose is inert text today.
2. **Fenced diffs → `diff-display` styling.** The renderer already exists for
   tool output. A diff the agent shows while _proposing_ a change currently
   renders as a plain fenced block.
3. **Tables → sortable / expandable.** Deferred. Needs more than delegation and
   the value is lower than 1 and 2. Do not bundle it into the first pass.

## Security requirements — non-negotiable

- **No relaxation of `FORBID_TAGS` or `FORBID_ATTR`.** If an enrichment appears
  to need one, the design is wrong.
- **Sanitizer round-trip test per new extension**, per that lib's guideline 6 —
  the emitted HTML must survive `DOMPurify.sanitize` under the current config
  with its `data-*` payload intact.
- **Treat every extracted value as hostile.** A path, line number or diff body
  parsed out of agent text is attacker-influenceable (prompt injection, a
  poisoned file read). The delegation handler must validate before acting —
  never pass a parsed path to a file-open RPC without checking it resolves
  inside the workspace.
- **Preserve the `/i` flag on `ALLOWED_URI_REGEXP`** and every other existing
  invariant in that file.

## Verify before building

1. Which RPC opens a file at a line, and what it validates. `libs/shared` has an
   `rpc/editor` namespace; confirm the exact method and its guarantees rather
   than assuming one exists.
2. What `file-path-link` does today — whether it is reusable behind delegation or
   is component-only, in which case the delegation handler duplicates its
   behaviour and the atom's future should be decided explicitly.
3. Every consumer of `provideMarkdownRendering('full')` vs `('basic')`,
   specifically what the member panel passes. The gate is only sound if that
   mapping is what this task assumes.
4. Whether `ngx-markdown` re-renders in a way that survives host-level
   delegation. Delegation on the host should be immune to inner re-render, but
   confirm rather than assume.
5. Whether any current consumer relies on `MarkdownBlockComponent` being free of
   outputs and host listeners.

## Non-goals

- Agent-authored components. Rejected above; do not partially reintroduce.
- Any change to `FlatStreamEventUnion`, the streaming path, or the surface
  router. This is a rendering-layer task only.
- Table interactivity (candidate 3) in the first pass.
- Anything in `libs/web` beyond confirming the preset gate protects it.

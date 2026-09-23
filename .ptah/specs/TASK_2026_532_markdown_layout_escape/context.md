# TASK_2026_532 — Agent output escapes its card and overlays the app layout

## Symptom

Twice on 2026-09-22 a full-window layer appeared over the Electron app header.
It showed file text with a `Line N:` prefix (lines 69–121 of
`libs/frontend/ui/src/lib/native/drawer/native-drawer.component.ts`), laid out
as one flex row across the top of the window. Line 67 of that file
(`<div class="fixed inset-0 z-50 flex" data-testid="native-drawer-root">`) was
missing from the text, and line 100 showed only `×` (its `<span>` was parsed).
So agent tool output was parsed as live HTML, and Tailwind classes
`fixed inset-0 z-50 flex` made a full-window overlay.

## Root cause (regression, commit 9c8a7d6e1, 2026-09-22)

`refactor(chat): render every cli lane through one execution tree` removed the
per-CLI switch in `agent-card.component.ts`. Before it, antigravity, opencode,
cursor and pi fell to `@default` → `AgentCardOutputComponent` fed by
`parsedOutput()` (parsed from stdout). Now every lane renders
`agent().segments` (structured, carrying FULL tool results) through the
ExecutionNode tree (`CliAgentOutputComponent`).

Two routes now carry raw tool output into markdown:

1. **Orphan tool results.**
   `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts`
   (~line 327): a `tool-result` / `tool-result-error` / `command` /
   `file-change` segment with no matching tool node becomes a
   `type: 'text'` node → `ExecutionNodeComponent` → `<markdown [data]>` with
   the raw content. Raw HTML in a file becomes real elements.
2. **Fence break-out.**
   `libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts`
   `formattedOutput` wraps output in a fixed three-backtick fence. Output that
   itself contains a backtick fence (the drawer file has ```` ```html ```` in its
   JSDoc) closes the fence early; everything after it is live markdown/HTML.
   `detectLanguage() === 'markdown'` also returns the output unfenced.

Enabler: the `'full'` DOMPurify preset in
`libs/frontend/markdown/src/lib/provide-markdown-rendering.ts` is a deny-list
that keeps `class`, `style` and `id`. Any surviving element can use the app's
Tailwind utilities (`fixed`, `inset-0`, `z-50`) and escape its container.
`overflow` on an ancestor does not contain `position: fixed`.

# Context - TASK_2026_696_9529

## User request (2026-10-18)

> can you ask grok and glm to imagine a canvas enhancements and a polishing phase to enhance
> visual parts with intuitive ideas and stats that we do have similar in our main chat view
> already and let each one generate a polishing redesign of the voice page backed by facts and
> components we already use in main chat and true canvas expertise enhancements for performant
> and stunning looking items ( i don't want a redesign from scratch i want to build upon what we
> do have and imagine new tweaks that can enhance it )

## Rules for the proposals

- Build on what exists. No redesign from scratch. The user likes the canvas radial layout and
  motion (TASK_2026_689 was reverted for that reason).
- Every idea is backed by facts: an existing component, store, signal or stat in this repository,
  cited with file:line. Main-chat sources to reuse: session stats / cost / tokens / context
  badges, agent and tool status, provider marks (`@ptah-extension/ui`), avatars.
- Canvas ideas must be performant (2D canvas, sprite cache, reduced motion, DPR, frame budget).
- Two independent authors: grok and Glm (ptah-cli, Ollama Cloud). Each writes its own file.

## State of the Voice page

- `main` (`68227b71d`): canvas scene (`libs/frontend/command-center/src/lib/scene/`), DOM
  overlay plate and hover card with provider marks + Lucide state icons (PR #753), work list,
  selected-node panel, composer, voice dock.
- PR #757 (open, worktree `.claude-worktrees/command-center-session-start`): start view with
  recent-session cards (`components/command-center-start.component.ts`).
- TASK_2026_695 (in progress): restored sessions keep their provider id.

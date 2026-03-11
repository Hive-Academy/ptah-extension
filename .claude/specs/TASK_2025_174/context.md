# TASK_2025_174: Smart Prompt Suggestions Component

## User Request

Build a child component for the capabilities and "Get Started" section that reflects extensive plugin usage, especially orchestration features. Should showcase beautiful, compact prompt suggestions that users can click to fill the chat input. Prompts should be intelligent and access important project details.

## Task Type: FEATURE

## Complexity: Medium

## Workflow: Partial (Architect → Frontend Developer)

## Key Files

- `libs/frontend/chat/src/lib/components/molecules/setup-plugins/chat-empty-state.component.ts` (parent)
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts` (input target)
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` (wiring)
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` (wiring)

## Integration Points

- `ChatInputComponent.restoreContentToInput(content)` — fills textarea programmatically
- `ChatStore.queueRestoreSignal` — existing signal pattern for content restoration
- `ChatEmptyStateComponent` — parent component that will embed the new child
- `ChatViewComponent` — orchestrates empty state and chat input

## Requirements

1. New `PromptSuggestionsComponent` as a child of the empty state
2. Categorized by orchestration workflow types (Feature, Bugfix, Review, Research, Refactor, Creative)
3. Each prompt is clickable → fills chat input via output event
4. Beautiful, compact design matching Egyptian/Anubis theme
5. Prompts should be intelligent — reference actual slash commands (/orchestrate, /review-code, /simplify)
6. Replace the static "Get Started" section with dynamic prompt suggestions

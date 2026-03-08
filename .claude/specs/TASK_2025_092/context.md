# Task Context - TASK_2025_092

## User Intent

Replace Angular CDK Overlay components with VS Code Webview UI Toolkit native components. Create new overlay and selection components in libs/frontend/ui that use @vscode/webview-ui-toolkit instead of @angular/cdk/overlay. The new components should replace: DropdownComponent, PopoverComponent, OptionComponent, AutocompleteComponent. Then migrate chat-input.component.ts and unified-suggestions-dropdown.component.ts to use the new native components. This fixes persistent keyboard navigation issues caused by CDK Overlay incompatibility with VS Code webviews.

## Conversation Summary

- User reported fatal hang/freeze in extension when typing @ or / triggers
- Deep investigation revealed multiple issues in CDK Overlay-based components:
  1. Signal dependency loop in effects (optionId() tracked as dependency)
  2. Subscription leaks in keyManager.change
  3. CDK Overlay portal rendering conflicts with VS Code webview sandboxing
- User confirmed significant time spent debugging keyboard navigation with no resolution
- Decision: Complete replacement of CDK Overlay with VS Code Webview UI Toolkit native components

## Technical Context

- Branch: feature/TASK_2025_092-vscode-toolkit-migration
- Created: 2025-12-27
- Type: REFACTORING
- Complexity: Medium-Complex (multiple component replacements + migration)

## Execution Strategy

REFACTORING strategy:

1. software-architect → Design new component architecture
2. USER VALIDATES
3. team-leader MODE 1-3 → Decompose and implement
4. USER CHOOSES QA
5. modernization-detector → Future enhancements

## Key Files to Replace/Migrate

**Current CDK-based components (to replace):**

- libs/frontend/ui/src/lib/overlays/dropdown/dropdown.component.ts
- libs/frontend/ui/src/lib/overlays/popover/popover.component.ts
- libs/frontend/ui/src/lib/selection/option/option.component.ts
- libs/frontend/ui/src/lib/selection/autocomplete/autocomplete.component.ts

**Consumer components (to migrate):**

- libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts
- libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts
- libs/frontend/chat/src/lib/directives/at-trigger.directive.ts
- libs/frontend/chat/src/lib/directives/slash-trigger.directive.ts

## Success Criteria

1. Extension no longer hangs when typing @ or / triggers
2. Keyboard navigation works correctly (ArrowUp/Down, Enter, Escape)
3. All autocomplete functionality preserved
4. No Angular CDK Overlay dependencies in overlay/selection components

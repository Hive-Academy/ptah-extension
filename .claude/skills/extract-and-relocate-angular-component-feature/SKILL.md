---
name: extract-and-relocate-angular-component-feature
description: Extract a UI feature (buttons, forms, state, methods) from one Angular component into a new self-contained component, then wire it into the destination component. Use when moving a feature between components in an Angular monorepo to eliminate duplication and improve encapsulation.
---

## Steps

1. **Identify source and destination components** — Locate the component currently rendering the feature and where it needs to move. Review both templates and identify the feature block (template markup + related state + event handlers).

2. **Clarify scope and context** — If the destination renders only in certain contexts (e.g., grid mode vs. detail panel), ask whether the feature should follow the destination's visibility or render in both. This prevents silent regressions.

3. **Create a new self-contained component** — In the same library, create a new component file with:
   - Descriptive kebab-case name (e.g., `send-message.component.ts`)
   - `@Input()` properties for required data (e.g., `tabId`, `sessionId`)
   - `@Output()` event emitters for parent-state changes (instead of injecting parent services)
   - All state signals (`signal()`, `computed()`) used only by this feature
   - All event handler methods scoped to the feature
   - Template markup copied from the source

4. **Export from the library barrel** — Add the new component to the library's `index.ts` so it's importable by other libraries.

5. **Wire into the destination component** — In the destination:
   - Import the extracted component
   - Add it to the `imports` array
   - Render it in the template at the intended location
   - Bind required inputs using bracket notation
   - Subscribe to outputs if the feature emits state changes

6. **Clean the source component** — Remove:
   - The feature's template block (HTML)
   - Imports specific only to that feature
   - All state and methods tied solely to the feature
   - Keep read-only guards or banners that affect the input flow

## Gotchas

- **Shared dependencies**: If the feature's state is used elsewhere in the source, leave it there; extract only isolated features.
- **Portability via outputs**: Emit parent-state changes via `@Output()` rather than injecting the parent service — keeps the component reusable.
- **Barrel exports are critical**: Omit the barrel export and consumers won't find the component.
- **Context changes cause regressions**: Silent visibility changes (feature hidden in one mode but rendered in another) are easy to miss—always clarify.

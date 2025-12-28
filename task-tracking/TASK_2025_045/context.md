# TASK_2025_045 - Rich Text Input Component with Mentions & Commands

## User Request

**Date**: 2025-12-04
**Priority**: HIGH
**Type**: ENHANCEMENT (Component Replacement)

### Original Problem Report

User identified multiple issues with current textarea-based autocomplete:

1. **Dropdown UI Completely Broken**

   - Max width not properly set
   - Flex layout not properly utilized
   - Nav items (tabs) and files not in separate rows
   - Visual hierarchy unclear

2. **Missing Folder Selection**

   - Currently only files can be selected via `@` trigger
   - No support for folder/directory selection

3. **Limited Textarea Capabilities**
   - Plain `<textarea>` cannot display commands/agents as badges/chips
   - Cannot utilize full Angular capabilities (signals, directives, components)
   - Cannot show visual tags for selected mentions

### User's Proposed Solution

> "what if you made a special input component that accepts slash commands, agents and also prompts text? this way we can show commands and agents as badges and allow for maximum utilization of angular capabilities? we could make that as a directive or a separate component that we can use inside our chat component replaceing the pure textarea html?"

**Requirements**:

- Replace plain `<textarea>` with rich text input component
- Support `/` slash commands (show as badges)
- Support `@` agent mentions (show as badges)
- Support `@` file/folder mentions (show as chips/tags)
- Support plain text prompts
- Directive OR component approach (to be decided)
- Maximum Angular capabilities utilization

### User Instruction

> "make web search and consult angular best practices and create a new task for this matter please TASK 45"

---

## Context Summary

### Current Implementation (TASK_2025_042)

**Current Architecture**:

```
<textarea>
  - ptahAtTrigger directive (@mentions)
  - ptahSlashTrigger directive (/commands)
  + UnifiedSuggestionsDropdownComponent (autocomplete UI)
```

**Limitations**:

1. Cannot display selected mentions as visual badges/chips
2. Plain text only (no rich formatting)
3. Dropdown UI issues (improper flex, max-width, visual hierarchy)
4. No folder selection support
5. Selected agents/commands appear as text, not badges

### Recent Fixes (TASK_2025_042)

- ✅ Cache invalidation on session change
- ✅ RPC failure error handling
- ✅ Race condition prevention
- ✅ Trigger text replacement (no longer appends duplicates)
- ✅ File name readability (prominent display)
- ✅ Tabs visual separation
- ✅ Agent icon semantics (🛠️ for project agents)

**But**: All fixes are band-aids on a fundamentally limited textarea.

---

## Research Findings

### Angular-Specific Research

#### 1. **Angular Signal Forms (Latest - 2025)**

**Source**: [Angular Signal Forms - Ninja Squad](https://blog.ninja-squad.com/2025/11/04/angular-signal-forms-part-1/)

- Angular now has a **third approach** for forms entirely based on signals
- Available in `@angular/forms/signals` package
- Use `[field]` directive for automatic two-way binding
- Perfect for simple forms with local/component UI state

#### 2. **ContentEditable with Angular Forms**

**Sources**:

- [Contenteditable in Angular - Medium](https://medium.com/its-tinkoff/controlvalueaccessor-and-contenteditable-in-angular-6ebf50b7475e)
- [Angular 2 forms with contentEditable - Stack Overflow](https://stackoverflow.com/questions/39655336/angular-2-forms-with-contenteditable-div-and-ngmodel-support)

**Key Findings**:

- Angular does NOT have built-in accessor for `contenteditable`
- Must implement `ControlValueAccessor` interface manually
- Requires providing `NG_VALUE_ACCESSOR` token
- Must implement: `registerOnChange`, `registerOnTouched`, `writeValue`

**Example Pattern**:

```typescript
@Directive({
  selector: '[contenteditable][formControlName], [contenteditable][formControl]',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: ContenteditableDirective,
      multi: true,
    },
  ],
})
export class ContenteditableDirective implements ControlValueAccessor {
  // Implementation
}
```

#### 3. **Angular Mentions Libraries**

**Source**: [angular-mentions on Kandi](https://kandi.openweaver.com/typescript/dmacfarlane/angular-mentions)

**Library**: `dmacfarlane/angular-mentions`

- Simple Angular @mentions component
- Supports text inputs, textareas, AND contenteditable fields
- Auto-complete for mentions
- Popular choice for Angular mention functionality

**Import**: `import { MentionModule } from 'angular-mentions/';`

#### 4. **Angular Rich Text Editor (Angular 19+)**

**Source**: [angular-elements/rich-text-editor - GitHub](https://github.com/angular-elements/rich-text-editor)

- Simple native WYSIWYG editor for Angular 19+
- Demonstrates contenteditable best practices
- Could serve as reference implementation

#### 5. **Angular Material Limitation**

**Source**: [matAutocomplete with contenteditable - GitHub Issue](https://github.com/angular/components/issues/23257)

- `[matAutocomplete]` only works with text inputs
- Using with `contenteditable` throws errors
- Feature request open since 2020 (not prioritized)

**Implication**: Cannot use Angular Material autocomplete directly.

---

### General UI/UX Best Practices

#### 1. **Autocomplete UX Design**

**Sources**:

- [9 UX Best Practices for Autocomplete - Baymard](https://baymard.com/blog/autocomplete-design)
- [Five Simple Steps For Better Autocomplete UX - Smart Interface Design Patterns](https://smart-interface-design-patterns.com/articles/autocomplete-ux/)

**Key Findings**:

- ⚠️ **Only 19% of sites get all implementation details right**
- **Limit suggestions to <10 items** (prevents choice paralysis)
- **Always support keyboard navigation** (Up/Down, Enter, Escape)
- **Display suggestions immediately** with frequently used options
- **Add visual grouping** for diverse information types (Files vs Agents)
- **Dim page background** when autocomplete active (helps focus)

#### 2. **Technical Implementation Requirements**

**Sources**:

- [Autocomplete Pattern - UX Patterns](https://uxpatterns.dev/patterns/forms/autocomplete)
- [Guidelines For Better Autocomplete UX - LinkedIn](https://www.linkedin.com/pulse/designing-better-autocomplete-ux-vitaly-friedman)

**Must-Have Features**:

- ✅ Live filtering
- ✅ Real-time suggestion updates
- ✅ Keyboard navigation
- ✅ Screen reader compatibility (ARIA attributes)
- ✅ Spinner for background requests
- ✅ Error messages with retry buttons
- ✅ No network available messages

**Mobile Attributes**:

```html
autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false"
```

(Prevents browser suggestions from interfering)

#### 3. **Accessibility (ARIA)**

**Sources**:

- [Autocomplete ARIA Guide - Angular](https://angular.dev/guide/aria/autocomplete)
- [Autocomplete UX Patterns](https://uxpatterns.dev/patterns/forms/autocomplete)

**Required ARIA Attributes**:

- `role="combobox"` on input element
- `aria-autocomplete="list"`
- `aria-haspopup="listbox"`
- `aria-expanded="true/false"`
- `aria-controls="listbox-id"`
- `aria-activedescendant="active-option-id"`

**Purpose**: Instruct screen readers about autocomplete state and navigation.

---

### React Mention Components (Reference)

**Sources**:

- [react-mentions - GitHub](https://github.com/signavio/react-mentions)
- [Building a Comment Form with React-Mentions - OpenReplay](https://blog.openreplay.com/building-a-comment-form-with-react-mentions/)

**Architecture Pattern** (adaptable to Angular):

1. **Main Component**: `MentionsInput`

   - Renders the textarea/contenteditable control
   - Takes multiple `Mention` components as children

2. **Data Source Component**: `Mention`

   - Each represents a data source for mentionable objects
   - Can be: `@users`, `@files`, `#channels`, etc.

3. **Async Data Loading**:
   - If function passed as `data` prop, called with current search query
   - Callback provides results asynchronously after fetch

**Key Insight**: Separate concerns - Input component manages UI, Mention components manage data sources.

---

### Slack Implementation Guidelines

**Source**: [Enabling Slash commands - Slack API](https://api.slack.com/interactivity/slash-commands)

**Best Practices**:

- Translate mentions into IDs (e.g., `@username` → `<@U123456>`)
- Rarely use broad mentions (`@channel`, `@here`, `@everyone`)
- Get explicit permission before using broadcast mentions
- Only for critical system notifications

**Implication**: Our mentions should resolve to IDs/paths internally but display as badges.

---

## Component Libraries (Chips/Badges)

### 1. **Material Design Bootstrap (MDB Angular)**

**Source**: [Angular Bootstrap Chips - MDB](https://mdbootstrap.com/docs/angular/components/chips/)

- `MdbChipsModule` and `MdbFormsModule`
- Pre-built chip/badge components
- Could be used for displaying selected mentions

### 2. **Angular Material**

**Source**: [Angular Material Badges](https://material.angular.dev/components/badge/examples)

- Standard Material Design badge component
- Highly customizable
- Good accessibility support

### 3. **Syncfusion Angular Chips**

**Source**: [Getting started with Angular Chips - Syncfusion](https://ej2.syncfusion.com/angular/documentation/chips/getting-started)

- Commercial library with chips component
- Rich feature set

**Note**: DaisyUI already provides badge components, no need for external library.

---

## Technical Challenges

### 1. **ContentEditable Complexity**

**Source**: [The Complexities of Implementing Inline Autocomplete for Content Editables - Medium](https://medium.com/streak-developer-blog/the-complexities-of-implementing-inline-autocomplete-for-content-editables-e358c0ed504b)

**Challenges**:

- Must listen to multiple events: `keyup`, `input`, `click`, `focus`
- Getting text around cursor requires:
  1. Get text node at cursor position
  2. Get parent node
  3. Call `normalize()`
- Cursor position management is complex
- Range selection requires `document.createRange()`

### 2. **Signal vs Reactive Forms**

**Source**: [Don't use Signals with Angular Reactive Forms](https://zoaibkhan.com/blog/dont-use-signals-with-angular-reactive-forms/)

**Guidance**:

- **Signals**: Perfect for local/component UI state, simple forms
- **Reactive Forms**: Gold standard for complex, validation-heavy forms
- **Don't Mix**: Using both together increases complexity

**Recommendation for our use case**:

- Use **Signal Forms** (Angular's new `@angular/forms/signals`)
- Our input is simple: text + mentions + commands
- No complex validation needed
- Signals align with Angular 20+ best practices

---

## Proposed Architecture Options

### Option A: ContentEditable Directive + Badge Display

**Structure**:

```html
<div class="mention-input-container">
  <!-- Badge display area -->
  <div class="mention-badges">
    @for (mention of selectedMentions()) {
    <span class="badge">{{ mention.name }}</span>
    }
  </div>

  <!-- Input area -->
  <div contenteditable="true" ptahMentionInput [field]="messageField"></div>
</div>
```

**Pros**:

- Clean separation of concerns
- Badges separate from input
- Easier cursor management

**Cons**:

- Mentions not inline with text
- User experience different from Slack/Discord

### Option B: Inline ContentEditable with DOM Manipulation

**Structure**:

```html
<div contenteditable="true" ptahRichInput [field]="messageField">Text content with <span class="badge">@mention</span> inline</div>
```

**Pros**:

- True inline mentions (like Slack)
- More natural UX

**Cons**:

- Complex DOM manipulation
- Cursor position management difficult
- HTML sanitization required
- More edge cases

### Option C: Hybrid - Chips Above, ContentEditable Below

**Structure**:

```html
<div class="rich-input-container">
  <!-- File chips (above input) -->
  <div class="file-chips">
    @for (file of selectedFiles()) {
    <div class="chip">📄 {{ file.name }}</div>
    }
  </div>

  <!-- Input with inline agent/command mentions -->
  <div contenteditable="true" ptahRichInput>/orchestrate @backend-developer explain the code</div>
</div>
```

**Pros**:

- Files as chips (visual, removable)
- Agents/commands inline (natural flow)
- Balances complexity vs UX

**Cons**:

- Two different mention patterns
- Slightly inconsistent

---

## Implementation Decision Factors

### 1. **Complexity vs Value**

**Current Issues**:

- Dropdown UI issues (fixable with CSS/flex)
- Folder selection (extendable feature)
- No visual badges (UX enhancement, not blocker)

**Rich Text Editor**:

- High complexity (contenteditable, cursor management, DOM manipulation)
- Moderate value (badges are nice-to-have)
- Risk: Could introduce new bugs

### 2. **Time Investment**

**Textarea Fixes** (Current approach):

- 1-2 days to fix remaining UI issues
- Low risk

**Rich Text Component**:

- 5-7 days for MVP
- High risk (many edge cases)

### 3. **User Priority**

User explicitly requested:

> "make web search and consult angular best practices and create a new task"

This suggests **strategic planning**, not immediate implementation.

---

## Recommendation

### Phase 1: Fix Current Dropdown UI Issues (IMMEDIATE)

**Tasks**:

1. ✅ Fix max-width for dropdown (set to textarea width)
2. ✅ Properly utilize flex for nav items (separate row)
3. ✅ Add folder selection support to file picker

**Effort**: 4-6 hours
**Risk**: Low
**Impact**: Solves immediate user pain points

### Phase 2: Research & Design Rich Input Component (THIS TASK)

**Tasks**:

1. ✅ Create TASK_2025_045 with research (this document)
2. Create architectural design document
3. Create visual design mockups
4. Identify implementation challenges
5. Get user approval on approach

**Effort**: 8-12 hours
**Risk**: Low (research only)
**Impact**: Informed decision-making

### Phase 3: Implement Rich Input Component (FUTURE TASK)

**Tasks**:

1. Implement ContentEditableDirective with ControlValueAccessor
2. Implement mention badge rendering
3. Implement cursor position management
4. Implement DOM manipulation for inline badges
5. Add ARIA attributes for accessibility
6. Add keyboard navigation
7. Add mobile optimizations
8. Comprehensive testing

**Effort**: 5-7 days
**Risk**: High
**Impact**: Enhanced UX, modern Angular patterns

---

## Success Criteria

### Phase 1 (Immediate Fixes)

- [ ] Dropdown has proper max-width (matches textarea)
- [ ] Tabs and suggestions in separate rows with clear visual hierarchy
- [ ] Folder selection works via @ trigger
- [ ] All existing autocomplete functionality preserved

### Phase 2 (Research - This Task)

- [x] Research Angular contenteditable best practices
- [x] Research mention component patterns
- [x] Research UX/accessibility guidelines
- [x] Document architecture options
- [x] Create task tracking document
- [ ] Get user approval on approach
- [ ] Create detailed implementation plan

### Phase 3 (Implementation - Future)

- [ ] ContentEditable component works with Angular Signal Forms
- [ ] Commands show as badges (`/orchestrate` → badge)
- [ ] Agents show as badges (`@backend-developer` → badge)
- [ ] Files show as chips (removable)
- [ ] Folders selectable via @ trigger
- [ ] Full keyboard navigation
- [ ] ARIA compliance (screen reader accessible)
- [ ] Mobile-optimized (no browser interference)
- [ ] No regressions in existing functionality

---

## Next Steps

1. **Immediate**: Present research findings to user
2. **User Decision**: Which architecture option to pursue?
3. **Design Phase**: Create detailed mockups and implementation plan
4. **Approval**: Get user sign-off before implementation
5. **Implementation**: Execute chosen architecture in future task

---

## References

### Angular-Specific

- [Angular Signal Forms - Ninja Squad](https://blog.ninja-squad.com/2025/11/04/angular-signal-forms-part-1/)
- [Contenteditable in Angular - Medium](https://medium.com/its-tinkoff/controlvalueaccessor-and-contenteditable-in-angular-6ebf50b7475e)
- [angular-mentions Library - Kandi](https://kandi.openweaver.com/typescript/dmacfarlane/angular-mentions)
- [angular-elements/rich-text-editor - GitHub](https://github.com/angular-elements/rich-text-editor)
- [Angular Forms with contentEditable - Stack Overflow](https://stackoverflow.com/questions/39655336/angular-2-forms-with-contenteditable-div-and-ngmodel-support)

### UX/Accessibility

- [9 UX Best Practices for Autocomplete - Baymard](https://baymard.com/blog/autocomplete-design)
- [Five Simple Steps For Better Autocomplete UX - Smart Interface Design](https://smart-interface-design-patterns.com/articles/autocomplete-ux/)
- [Autocomplete ARIA Guide - Angular](https://angular.dev/guide/aria/autocomplete)
- [Autocomplete Pattern - UX Patterns](https://uxpatterns.dev/patterns/forms/autocomplete)

### React References (Pattern Learning)

- [react-mentions - GitHub](https://github.com/signavio/react-mentions)
- [Building a Comment Form with React-Mentions - OpenReplay](https://blog.openreplay.com/building-a-comment-form-with-react-mentions/)

### Component Libraries

- [Angular Bootstrap Chips - MDB](https://mdbootstrap.com/docs/angular/components/chips/)
- [Angular Material Badges](https://material.angular.dev/components/badge/examples)
- [Syncfusion Angular Chips](https://ej2.syncfusion.com/angular/documentation/chips/getting-started)

### Platform Guidelines

- [Enabling Slash commands - Slack API](https://api.slack.com/interactivity/slash-commands)
- [The Complexities of Inline Autocomplete - Medium](https://medium.com/streak-developer-blog/the-complexities-of-implementing-inline-autocomplete-for-content-editables-e358c0ed504b)

# Batch B4 report: renderer omits empty title (Task B4.1)

**Status: DONE** — `SurfaceRendererComponent` renders its `<h2>` title heading only when the title text, trimmed, is non-empty. The Apps page (always a non-empty title) is unchanged: the existing non-empty-title test still passes untouched.

## Diff summary (exact)

### `libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.ts`

Template (`surface-root` header, ~line 192) — the heading is wrapped in a control-flow block; the description line in the same header is untouched:

```diff
         <header class="col-span-full flex flex-col gap-0.5">
-          <h2 class="text-base font-semibold">{{ title() }}</h2>
+          @if (hasTitle()) { <h2 class="text-base font-semibold">{{ title() }}</h2> }
           @if (description(); as description) { <p class="text-xs text-base-content-muted">{{ description }}</p> }
         </header>
```

Class — new `computed()` derived from the existing `title` view-model signal (no method call in the template):

```diff
   public readonly title = computed(() => plainText(this.viewModel()?.title) ?? '');
+  /** A title of blank text is no title: the heading renders only for real text. */
+  public readonly hasTitle = computed(() => this.title().trim().length > 0);
   public readonly description = computed(() => plainText(this.viewModel()?.description));
```

`ChangeDetectionStrategy.OnPush`, signals and the rest of the component/template are unchanged. `{ text: '' }` / `{ text: '   ' }` remain valid rich text (`isRichText` only requires a string `text`), so these surfaces still build successfully — only the heading hides.

### `libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.spec.ts`

No existing test modified. Added a module-scope helper (mirrors the existing `withId` spread pattern) after `TOO_LONG`:

```diff
 const TOO_LONG = 'x'.repeat(SURFACE_LIMITS.maxStringLength + 1);
+/** The default form surface with its root title text replaced. */
+const withTitle = (text: string): SurfaceRenderable => {
+  const v2 = form() as Extract<SurfaceRenderable, { contract: 'dashboard-spec/2' }>;
+  return { ...v2, surface: { ...v2.surface, title: { text } } };
+};
```

Added two tests directly after the existing title-rendering test:

```diff
+  it('renders no title heading when the title text is empty', () => {
+    const { element, host } = setup(withTitle(''));
+    expect(element.querySelector('h2')).toBeNull();
+    expect(element.querySelector('header p')?.textContent).toBe('Roll back the last deploy.');
+    expect(element.querySelector('section h3')?.textContent).toBe('Form');
+    expect(host.failures).toBe(0);
+  });
+
+  it('renders no title heading when the title text is spaces only', () => {
+    const { element, host } = setup(withTitle('   '));
+    expect(element.querySelector('h2')).toBeNull();
+    expect(element.querySelector('header p')?.textContent).toBe('Roll back the last deploy.');
+    expect(element.querySelector('section h3')?.textContent).toBe('Form');
+    expect(host.failures).toBe(0);
+  });
```

Both also assert the description, the section and a clean build (`failures` 0) so only the heading is hidden, not the surface.

## Test counts

| | Before | After |
|---|---|---|
| `surface-renderer.component.spec.ts` | **39 passed / 39** | **41 passed / 41** |

- Command (run before and after the edits, from the worktree root):
  `npx jest -c libs/frontend/declarative-dashboard/jest.config.ts libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.spec.ts --maxWorkers=2`
- Before: `Test Suites: 1 passed, 1 total` / `Tests: 39 passed, 39 total` — exit code 0.
- After: `Test Suites: 1 passed, 1 total` / `Tests: 41 passed, 41 total` — exit code 0.
- The pre-existing non-empty-title test (`builds through the root default builder and renders title, description and components`, asserts `h2` = 'Rollback request') passes unchanged after the change.

## Typecheck and lint

- Command (worktree root): `npx nx run-many -t typecheck,lint -p @ptah-extension/declarative-dashboard --parallel=1`
- Result (exit code 0):
  ```
  √  nx run @ptah-extension/declarative-dashboard:typecheck
  √  nx run @ptah-extension/declarative-dashboard:lint

   NX   Successfully ran targets typecheck, lint for project @ptah-extension/declarative-dashboard
  ```
  (The trailing "Nx Cloud … FREE plan" notice is telemetry-only; the run itself reported success, exit code 0.)

## Notes

- Verified against source before relying on it: `plainText` (`surface-input-messages.ts:22`) returns the rich-text `text` string; `isRichText` (`surface-view-model.ts:37`) accepts any string `text`, so blank titles are valid builds, not `renderFailed`.
- Only the two assigned files were touched; no git commands run.

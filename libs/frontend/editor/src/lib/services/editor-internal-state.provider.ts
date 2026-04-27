/**
 * provideEditorInternalState — Composition-root helper for binding the
 * `EDITOR_INTERNAL_STATE` token to the `EditorService` instance.
 *
 * TASK_2026_103 Wave F3. Mirrors B1's `provideStreamingControl()` and F1's
 * `provideWizardInternalState()` shapes so the webview app config wires
 * the inverted contract alongside the other cycle-breaking providers.
 *
 * Usage in app.config.ts:
 *
 *   providers: [
 *     ...
 *     ...provideEditorInternalState(),
 *   ]
 *
 * The factory reads `getInternalState()` off the singleton coordinator so
 * external consumers can inject the writable-signal map without depending
 * on the coordinator class — that import direction is what previously
 * formed the cycle with the in-process editor helpers.
 */

import { inject, type Provider } from '@angular/core';

import { EditorService } from './editor.service';
import { EDITOR_INTERNAL_STATE } from './editor/editor-internal-state';

export function provideEditorInternalState(): Provider[] {
  return [
    {
      provide: EDITOR_INTERNAL_STATE,
      useFactory: () => inject(EditorService).getInternalState(),
    },
  ];
}

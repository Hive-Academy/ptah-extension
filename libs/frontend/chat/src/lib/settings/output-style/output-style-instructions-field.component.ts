/**
 * OutputStyleInstructionsFieldComponent — the style's instruction content inside the output style editor
 * (TASK_2026_555 Batch 55b CS-2, split out of {@link OutputStyleEditorComponent} unchanged):
 *  - the "Keep the default coding instructions" toggle (Req 6.4), with its hint or its warning;
 *  - the Instructions body with "Edit" | "Preview" tabs via {@link NativeTabGroupComponent} (Gap G6), the preview
 *    rendered by {@link MarkdownBlockComponent} (DOMPurify chokepoint, no innerHTML).
 *
 * The editor owns both values (`[(keepCodingInstructions)]`, `[(body)]`) and decides dirty state and the save; this
 * field only edits them and switches the view.
 */

import { ChangeDetectionStrategy, Component, computed, model, signal } from '@angular/core';
import { LucideAngularModule, AlertTriangle } from 'lucide-angular';
import { NativeTabGroupComponent, type NativeTab } from '@ptah-extension/ui';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';

@Component({
  selector: 'ptah-output-style-instructions-field',
  standalone: true,
  imports: [LucideAngularModule, NativeTabGroupComponent, MarkdownBlockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Block host: the editor form's space-y-3 sets a top margin, which an inline host ignores.
  host: { class: 'block' },
  template: `
    <div class="space-y-3">
      <!-- Keep coding instructions -->
      <div>
        <div
          class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-base-200/50 transition-colors"
        >
          <span class="text-xs font-medium flex-1 text-base-content">
            Keep the default coding instructions
          </span>
          <input
            type="checkbox"
            class="toggle toggle-xs toggle-primary"
            [checked]="keepCodingInstructions()"
            (change)="onKeepInstructionsChange($event)"
            aria-label="Keep the default coding instructions"
          />
        </div>
        @if (keepCodingInstructions()) {
          <p
            data-test="keep-instructions-on-hint"
            class="text-xs text-base-content-muted mt-1 px-2 leading-relaxed"
          >
            The style is added to the agent's normal coding behaviour. It
            influences how the agent writes and explains; the engineering
            guidance it already has stays in place.
          </p>
        } @else {
          <p
            data-test="keep-instructions-off-warning"
            class="flex items-start gap-1 text-xs text-base-content mt-1 px-2 leading-relaxed"
          >
            <lucide-angular [img]="AlertTriangleIcon" class="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            <span>
              Turning this off removes the SDK's built-in coding instructions.
              Ptah's own engineering behaviour is still appended to every session,
              so the effect here is smaller than in the
              <code>claude</code> CLI — but the agent loses guidance it normally
              has. Recommended only for styles that redefine the agent's whole
              role, not for adjusting tone.
            </span>
          </p>
        }
      </div>

      <!-- Body / Instructions with NativeTabGroupComponent (Gap G6) -->
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="text-xs font-medium text-base-content" for="output-style-body">
            Instructions
          </label>
          <ptah-native-tab-group
            [tabs]="editorTabs"
            [activeId]="activeTab()"
            (activeIdChange)="onTabChange($event)"
            ariaLabel="Instructions view mode"
          />
        </div>

        @if (showPreview()) {
          <div
            class="max-h-64 overflow-y-auto border border-base-300 rounded p-3 bg-base-200/50 text-base-content"
            data-test="body-preview"
          >
            @if (body().trim().length > 0) {
              <ptah-markdown-block [content]="body()" />
            } @else {
              <p class="text-xs text-base-content-muted">
                Nothing to preview yet.
              </p>
            }
          </div>
        } @else {
          <textarea
            id="output-style-body"
            rows="5"
            class="textarea textarea-bordered w-full text-xs font-mono leading-relaxed text-base-content"
            placeholder="Write in short sentences. Prefer plain words over jargon."
            [value]="body()"
            (input)="onBodyInput($event)"
          ></textarea>
        }
        <p class="text-xs text-base-content-muted mt-1 leading-relaxed">
          Markdown. This text influences how the agent writes — it does not
          override Ptah's own instructions, which are always applied as well.
        </p>
      </div>
    </div>
  `,
})
export class OutputStyleInstructionsFieldComponent {
  /** Req 6.4: ON by default in the editor, because the destructive value is the one omission gives. */
  readonly keepCodingInstructions = model.required<boolean>();
  /** The style's markdown body. */
  readonly body = model.required<string>();

  readonly AlertTriangleIcon = AlertTriangle;

  readonly editorTabs: readonly NativeTab[] = [
    { id: 'edit', label: 'Edit' },
    { id: 'preview', label: 'Preview' },
  ];

  /** Preview signal supported for both direct programmatic toggle and NativeTabGroup. */
  readonly showPreview = signal(false);
  readonly activeTab = computed(() => (this.showPreview() ? 'preview' : 'edit'));

  onTabChange(tabId: string | null): void {
    this.showPreview.set(tabId === 'preview');
  }

  onBodyInput(event: Event): void {
    this.body.set((event.target as HTMLTextAreaElement).value);
  }

  onKeepInstructionsChange(event: Event): void {
    this.keepCodingInstructions.set((event.target as HTMLInputElement).checked);
  }
}

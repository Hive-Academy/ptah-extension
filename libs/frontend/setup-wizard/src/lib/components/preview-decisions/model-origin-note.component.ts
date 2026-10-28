import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { AgentModelPreview } from '@ptah-extension/shared';

/** The parts of one model line; the model id is rendered bold. */
interface ModelNoteParts {
  /** Bold model id, or null for the "no model line" wording. */
  readonly model: string | null;
  /** Text after the model id. */
  readonly rest: string;
  /** Ignored override id, rendered as code. */
  readonly ignored: string | null;
  /** Text after the ignored override. */
  readonly tail: string;
}

/**
 * C6 ModelOriginNote: the model line a generated agent will carry and where
 * it comes from (design-spec section 5 host matrix). Electron names the
 * Library setting; VS Code, which has no Library (D3), names the saved
 * agent-model setting.
 */
@Component({
  selector: 'ptah-model-origin-note',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let note = parts();
    <p
      class="mt-1 text-[11px] text-base-content-muted [overflow-wrap:anywhere]"
      data-testid="model-origin-note"
    >
      <!-- One line: whitespace between the parts is significant. -->
      Agent model: @if (note.model) {<strong class="text-base-content">{{ note.model }}</strong>} @else {no model line}{{ note.rest }}@if (note.ignored) {<code class="font-mono">{{ note.ignored }}</code>{{ note.tail }}}
    </p>
  `,
})
export class ModelOriginNoteComponent {
  public readonly model = input.required<AgentModelPreview>();
  public readonly isElectron = input(true);

  protected readonly parts = computed<ModelNoteParts>(() => {
    const model = this.model();
    const setting = this.isElectron()
      ? 'the Library setting'
      : 'the saved agent-model setting';
    if (model.ignoredOverride) {
      return {
        model: model.value,
        rest: ` - ${setting} `,
        ignored: model.ignoredOverride,
        tail: ' is not a Claude model and will be ignored. Using the template model.',
      };
    }
    if (model.value === null) {
      return {
        model: null,
        rest: ' (the template declares none).',
        ignored: null,
        tail: '',
      };
    }
    if (model.origin === 'workspace' || model.origin === 'machine') {
      const source = this.isElectron()
        ? 'your Library setting'
        : 'your saved agent-model setting';
      return {
        model: model.value,
        rest: ` - from ${source} (${model.origin}).`,
        ignored: null,
        tail: '',
      };
    }
    return { model: model.value, rest: ' (template).', ignored: null, tail: '' };
  });
}

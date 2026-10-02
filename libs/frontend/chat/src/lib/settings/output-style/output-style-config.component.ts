/**
 * OutputStyleConfigComponent — the output-style section of the Advanced tab (A19-A25).
 *
 * P2 Section card matching `prototypes/final/orchestration.html` and Batch 45:
 *   - Heading with Palette icon + available styles count + "New style" primary action (A21)
 *   - Body mounts `OutputStyleListComponent` (matrix table, banners, command-line parity)
 *   - Drawer D-OS (`OutputStyleEditorComponent`) lazily loaded via `@defer (when view() === 'editor')`
 *   - Active style selection is persisted through {@link SettingsSaveFeedbackService.saveGeneric}
 *     with Undo (D15). Parity writes confirm first and have no Undo.
 */

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, Palette, Plus } from 'lucide-angular';
import type {
  InvalidOutputStyle,
  OutputStyleDetail,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { OutputStyleStore } from './output-style.store';
import {
  OutputStyleListComponent,
  type OutputStyleRef,
  type OutputStyleSelectionRequest,
} from './output-style-list.component';
import { OutputStyleEditorComponent } from './output-style-editor.component';

const OUTPUT_STYLE_ACTIVATE_FAILED = 'Could not change the active output style.';
/** Serious 2: the selection saved, the requested command-line file did not — the toast says so, not "Saved". */
const OUTPUT_STYLE_PARITY_FAILED =
  'Your style is active in Ptah, but the settings file for the command line could not be updated.';

@Component({
  selector: 'ptah-output-style-config',
  standalone: true,
  imports: [
    LucideAngularModule,
    OutputStyleListComponent,
    OutputStyleEditorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      class="card bg-base-200 border border-base-300 p-3"
      aria-labelledby="output-style-heading"
      data-testid="output-style-card"
    >
      <div class="flex items-center justify-between gap-3 mb-2">
        <div class="flex items-center gap-1.5">
          <lucide-angular
            [img]="PaletteIcon"
            class="w-4 h-4 text-secondary"
            aria-hidden="true"
          />
          <h2
            id="output-style-heading"
            class="text-xs font-bold uppercase tracking-wider text-base-content"
          >
            Output Style
          </h2>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs text-base-content-muted">
            {{ store.styles().length }} available
          </span>
          <button
            #newStyleButton
            type="button"
            class="btn btn-primary btn-xs gap-1"
            (click)="onCreate()"
            [disabled]="store.saving()"
            data-testid="output-style-new-button"
            aria-label="Create new output style"
          >
            <lucide-angular [img]="PlusIcon" class="w-3 h-3" aria-hidden="true" />
            New style
          </button>
        </div>
      </div>

      <p class="text-xs text-base-content-muted mb-3">
        Choose how the agent writes to you — how much it explains, how it
        structures an answer, what wording it prefers. A style influences the
        agent's voice; it does not replace the instructions Ptah already gives
        it.
      </p>

      <ptah-output-style-list
        [styles]="store.styles()"
        [invalid]="store.invalid()"
        [active]="store.active()"
        [loading]="store.loading()"
        [saving]="store.saving()"
        [failedOperation]="store.failedOperation()"
        [hasCollision]="store.hasCollision()"
        [collidingNames]="store.collidingNames()"
        [usingFallback]="store.usingFallbackInjection()"
        [parityWrittenPath]="store.parityWrittenPath()"
        [parityWarning]="store.parityWarning()"
        (activate)="onActivate($event)"
        (create)="onCreate()"
        (edit)="onEdit($event)"
        (remove)="onRemove($event)"
        (openInvalid)="onOpenInvalid($event)"
        (copyToProject)="onCopyToProject($event)"
        (dismissError)="store.dismissError()"
        (dismissParity)="store.dismissParityOutcome()"
      />

      @defer (when view() === 'editor') {
        @if (view() === 'editor') {
          <ptah-output-style-editor
            [isOpen]="view() === 'editor'"
            [draft]="draft()"
            [repair]="repair()"
            [activeName]="store.activeName()"
            (saved)="onSaved($event)"
            (cancelled)="showList()"
          />
        }
      }
    </section>
  `,
})
export class OutputStyleConfigComponent implements OnInit {
  readonly store = inject(OutputStyleStore);
  private readonly feedback = inject(SettingsSaveFeedbackService);

  private readonly list = viewChild(OutputStyleListComponent);
  private readonly newStyleButton = viewChild<ElementRef<HTMLButtonElement>>('newStyleButton');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly PaletteIcon = Palette;
  readonly PlusIcon = Plus;

  readonly view = signal<'list' | 'editor'>('list');
  readonly draft = signal<OutputStyleDetail | null>(null);
  readonly repair = signal<InvalidOutputStyle | null>(null);

  async ngOnInit(): Promise<void> {
    await this.store.refresh();
  }

  /**
   * Persists the active style selection through SettingsSaveFeedbackService.saveGeneric (D15).
   * Parity writes confirm beforehand and have no Undo (A24). Normal selections offer Undo.
   */
  async onActivate(request: OutputStyleSelectionRequest): Promise<void> {
    const previousName = this.store.activeName();
    const isParity = request.parity !== undefined && request.parity.enabled;

    await this.feedback.saveGeneric({
      label: 'output style',
      write: async () => {
        try {
          const success = await this.store.activate(request.name, request.parity);
          if (!success) return { ok: false, message: OUTPUT_STYLE_ACTIVATE_FAILED };
          return isParity && this.store.parityWarning() !== null
            ? { ok: false, message: OUTPUT_STYLE_PARITY_FAILED }
            : { ok: true };
        } catch {
          return { ok: false, message: OUTPUT_STYLE_ACTIVATE_FAILED };
        }
      },
      undo: isParity
        ? null
        : async () => {
            try {
              const success = await this.store.activate(previousName);
              return success
                ? { ok: true }
                : { ok: false, message: OUTPUT_STYLE_ACTIVATE_FAILED };
            } catch {
              return { ok: false, message: OUTPUT_STYLE_ACTIVATE_FAILED };
            }
          },
    });
    // A refused or failed activate leaves the clicked radio checked: show the saved style again (D15).
    this.list()?.syncActiveRadios(this.store.activeName());
  }

  onCreate(): void {
    this.draft.set(null);
    this.repair.set(null);
    this.view.set('editor');
  }

  async onEdit(ref: OutputStyleRef): Promise<void> {
    const detail = await this.store.load(ref.name, ref.tier);
    if (detail === null) return;

    this.draft.set(detail);
    this.repair.set(null);
    this.view.set('editor');
  }

  /** Req 7.5 — an unparseable user/project file is opened to be rewritten. */
  onOpenInvalid(entry: InvalidOutputStyle): void {
    this.draft.set(null);
    this.repair.set(entry);
    this.view.set('editor');
  }

  async onRemove(ref: OutputStyleRef): Promise<void> {
    await this.store.remove(ref.name, ref.tier);
  }

  /** Req 5.5 — copy the injected user-tier style into the project tier. */
  async onCopyToProject(name: string): Promise<void> {
    await this.store.copyToProjectTier(name);
  }

  /**
   * The save refreshed the list, so the Edit button that opened the drawer is gone: focus moves to the saved
   * style's Edit button, or to "New style" when that row has none (Moderate 7).
   */
  onSaved(name: string): void {
    this.showList();
    afterNextRender(() => (this.editButtonFor(name) ?? this.newStyleButton()?.nativeElement)?.focus(), {
      injector: this.injector,
    });
  }

  /** Back from the editor: a failure that belonged to the editor session no longer applies (Moderate 4). */
  showList(): void {
    this.draft.set(null);
    this.repair.set(null);
    this.view.set('list');
    this.store.dismissError(['save', 'open']);
  }

  private editButtonFor(name: string): HTMLButtonElement | undefined {
    const rows = this.host.nativeElement.querySelectorAll<HTMLElement>('tr[data-testid^="output-style-row-"]');
    return Array.from(rows)
      .filter((row) => row.getAttribute('data-testid') === `output-style-row-${name}`)
      .map((row) => row.querySelector<HTMLButtonElement>('[data-testid="output-style-edit-button"]'))
      .find((button): button is HTMLButtonElement => button !== null && !button.disabled);
  }
}

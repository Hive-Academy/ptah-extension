/**
 * OutputStyleConfigComponent — the output-style section of the Advanced tab.
 *
 * A thin shell: it owns the list/editor switch and the one round trip needed to
 * open a style for editing, and delegates everything else to `OutputStyleStore`
 * and its two child views.
 *
 * The section loads its data in ITS OWN `ngOnInit`, not in `SettingsComponent`.
 * Because it renders inside the `pro-features` `@if`, it is not instantiated at
 * all until the user opens the Advanced tab, so the settings panel's first
 * render is untouched by construction rather than by a timing promise.
 */

import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { LucideAngularModule, Palette } from 'lucide-angular';
import type {
  InvalidOutputStyle,
  OutputStyleDetail,
} from '@ptah-extension/shared';
import { OutputStyleStore } from './output-style.store';
import {
  OutputStyleListComponent,
  type OutputStyleRef,
  type OutputStyleSelectionRequest,
} from './output-style-list.component';
import { OutputStyleEditorComponent } from './output-style-editor.component';

@Component({
  selector: 'ptah-output-style-config',
  standalone: true,
  imports: [
    LucideAngularModule,
    OutputStyleListComponent,
    OutputStyleEditorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mt-4 block' },
  template: `
    <div class="border border-secondary/30 rounded-md bg-secondary/5">
      <div class="p-3">
        <div class="flex items-center gap-1.5 mb-2">
          <lucide-angular
            [img]="PaletteIcon"
            class="w-4 h-4 text-secondary"
            aria-hidden="true"
          />
          <h2 class="text-xs font-medium uppercase tracking-wide">
            Output Style
          </h2>
        </div>
        <p class="text-xs text-base-content-muted mb-3">
          Choose how the agent writes to you — how much it explains, how it
          structures an answer, what wording it prefers. A style influences the
          agent's voice; it does not replace the instructions Ptah already gives
          it.
        </p>

        @if (view() === 'list') {
          <ptah-output-style-list
            [styles]="store.styles()"
            [invalid]="store.invalid()"
            [active]="store.active()"
            [loading]="store.loading()"
            [saving]="store.saving()"
            [error]="store.error()"
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
        } @else {
          <ptah-output-style-editor
            [draft]="draft()"
            [repair]="repair()"
            [activeName]="store.activeName()"
            (saved)="onSaved()"
            (cancelled)="showList()"
          />
        }
      </div>
    </div>
  `,
})
export class OutputStyleConfigComponent implements OnInit {
  readonly store = inject(OutputStyleStore);

  readonly PaletteIcon = Palette;

  readonly view = signal<'list' | 'editor'>('list');
  readonly draft = signal<OutputStyleDetail | null>(null);
  readonly repair = signal<InvalidOutputStyle | null>(null);

  async ngOnInit(): Promise<void> {
    await this.store.refresh();
  }

  /**
   * `request.parity` is `undefined` unless the user ticked the opt-in box, and
   * the store omits the field entirely in that case — so the default path sends
   * no parity request and no settings file is written (R6).
   */
  async onActivate(request: OutputStyleSelectionRequest): Promise<void> {
    await this.store.activate(request.name, request.parity);
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

  onSaved(): void {
    this.showList();
  }

  showList(): void {
    this.draft.set(null);
    this.repair.set(null);
    this.view.set('list');
  }
}

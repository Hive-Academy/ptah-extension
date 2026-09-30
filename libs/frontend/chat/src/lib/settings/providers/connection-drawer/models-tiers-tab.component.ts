import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { ProvidersSettingsStateService, type ProvidersConnection } from '@ptah-extension/core';
import { ProviderModelPickerComponent, type ProviderModelSelection } from '@ptah-extension/ui';
import type { ProviderModelTier } from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../../feedback/settings-save-feedback.service';

interface TierRow {
  readonly tier: ProviderModelTier;
  readonly label: string;
  readonly hint: string;
}

const TIER_ROWS: readonly TierRow[] = [
  { tier: 'sonnet', label: 'Sonnet tier', hint: 'General work and coding' },
  { tier: 'opus', label: 'Opus tier', hint: 'Deep reasoning' },
  { tier: 'haiku', label: 'Haiku tier', hint: 'Fast subagents and triage' },
];

/**
 * Main-agent tiers apply to every connection except native Claude auth, which keeps the SDK's own model
 * defaults (the wizard's `tiersApply`, and `connectProvider` writes no tiers for them).
 */
export function tiersApply(connection: Pick<ProvidersConnection, 'id' | 'authMode'>): boolean {
  return connection.id !== 'anthropic' && connection.authMode !== 'cli';
}

/**
 * Drawer tab "Models & Tiers" (plan :659-665, prototype drawer Tab 3). One searchable picker per tier
 * (#34, with the tool-use summary #38 and the "Not listed? Enter a model ID" entry #35), saved on
 * selection through `SettingsSaveFeedbackService` with Undo (D2). Every `write`/`undo` is a
 * `ProvidersSettingsStateService.setMainAgentTier` call (Batch 17 review constraint): an empty model
 * clears the tier back to the provider default.
 *
 * The page toast sits outside the drawer's focus trap, so the same feedback (with Undo) also renders
 * inline here, where a keyboard user can reach it.
 */
@Component({
  selector: 'ptah-connection-models-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProviderModelPickerComponent],
  template: `
    <div class="space-y-4 text-sm" data-testid="connection-models">
      @if (!applies()) {
        <p class="rounded border border-base-300 bg-base-200 p-3 text-xs text-base-content" data-testid="models-native-note">
          {{ connection().name }} uses Claude's own model defaults, so there are no tiers to map here. Choose the main agent's
          model on the Main agent card.
        </p>
      } @else {
        <div class="flex items-center justify-between gap-3">
          <span class="font-semibold text-base-content">Tier model mapping</span>
          <span class="text-xs text-base-content-muted">Saved on selection</span>
        </div>
        @switch (tiers().status) {
          @case ('error') {
            <div role="alert" class="space-y-2 rounded border border-base-300 p-3 text-xs" data-testid="models-error">
              <p class="text-base-content">Could not load the tier mapping for this connection.</p>
              <button type="button" class="btn btn-outline btn-xs" (click)="load()">Retry</button>
            </div>
          }
          @default {
            @if (!tiers().data) {
              <div class="space-y-2" aria-busy="true" data-testid="models-skeleton">
                <span class="skeleton block h-10 w-full"></span>
                <span class="skeleton block h-10 w-full"></span>
                <span class="skeleton block h-10 w-full"></span>
              </div>
            } @else {
              <ul class="space-y-2 rounded border border-base-300 bg-base-200/50 p-3">
                @for (row of rows; track row.tier) {
                  <li class="space-y-1.5 border-b border-base-300 pb-2 last:border-b-0 last:pb-0" [attr.data-tier]="row.tier">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <p class="font-semibold text-base-content">{{ row.label }} <span class="font-normal text-base-content-muted">· {{ row.hint }}</span></p>
                        <p class="text-xs text-base-content-muted" [attr.data-testid]="'models-current-' + row.tier">
                          Mapped to: <span class="font-mono text-base-content">{{ current(row.tier) || 'Provider default' }}</span>
                        </p>
                      </div>
                      @if (current(row.tier)) {
                        <button type="button" class="btn btn-ghost btn-xs shrink-0" [disabled]="busy()"
                          [attr.aria-label]="'Reset ' + row.label + ' to the provider default'" (click)="save(row, '')"
                          [attr.data-testid]="'models-default-' + row.tier">Default</button>
                      }
                    </div>
                    <ptah-provider-model-picker [label]="row.label + ' model'" [fixedProvider]="connection().id" [provider]="connection().id"
                      [model]="current(row.tier)" [defaultTier]="row.tier" [searchable]="true" [disabled]="busy()"
                      (selectionChange)="onSelect(row, $event)" [attr.data-testid]="'models-picker-' + row.tier" />
                  </li>
                }
              </ul>
            }
          }
        }
      }
      @if (feedback.toast(); as toast) {
        <div [attr.role]="toast.tone" class="flex items-center gap-2 rounded border border-base-300 p-2.5 text-xs text-base-content"
          data-testid="models-feedback">
          <span [class]="toast.tone === 'status' ? 'h-2 w-2 shrink-0 rounded-full bg-success' : 'h-2 w-2 shrink-0 rounded-full bg-error'" aria-hidden="true"></span>
          <span class="min-w-0 flex-1">{{ toast.message }}</span>
          @if (toast.canUndo) {
            <button type="button" class="btn btn-outline btn-xs" [disabled]="busy()" (click)="feedback.undo()" data-testid="models-undo">Undo</button>
          }
        </div>
      }
    </div>
  `,
})
export class ModelsTiersTabComponent {
  private readonly state = inject(ProvidersSettingsStateService);
  protected readonly feedback = inject(SettingsSaveFeedbackService);
  readonly connection = input.required<ProvidersConnection>();

  protected readonly rows = TIER_ROWS;
  protected readonly applies = computed(() => tiersApply(this.connection()));
  protected readonly tiers = this.state.tiers;
  /** A save runs (D3), or the settings sources a save is reviewed against are not loaded yet. */
  protected readonly busy = computed(() => this.feedback.saving() || this.state.reviewContext() === null);
  private readonly connectionId = computed(() => this.connection().id);

  constructor() {
    // The main-agent tiers of THIS connection; `refreshTiers` blanks another provider's mapping first.
    effect(() => {
      this.connectionId();
      if (this.applies()) untracked(() => this.load());
    });
  }

  protected load(): void {
    void this.state.refreshTiers({ providerId: this.connection().id, scope: 'mainAgent' });
  }

  protected current(tier: ProviderModelTier): string {
    return this.tiers().data?.[tier] ?? '';
  }

  protected onSelect(row: TierRow, selection: ProviderModelSelection): void {
    if (selection.model === this.current(row.tier)) return;
    void this.save(row, selection.model);
  }

  /** Saves on selection; Undo writes the value the tier had before, through the same state method. */
  protected async save(row: TierRow, model: string): Promise<void> {
    const providerId = this.connection().id;
    const previous = this.current(row.tier);
    const context = this.state.reviewContext();
    if (!context) return;
    await this.feedback.save({
      label: `${this.connection().name} ${row.label.toLowerCase()} model`,
      scope: 'global',
      write: () => this.state.setMainAgentTier(providerId, row.tier, model, context),
      undo: () => this.state.setMainAgentTier(providerId, row.tier, previous, context),
    });
  }
}

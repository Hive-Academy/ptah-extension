import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { ChevronDown, Ellipsis, LucideAngularModule, Plus } from 'lucide-angular';
import {
  NativePopoverComponent,
  ProviderMarkComponent,
} from '@ptah-extension/ui';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';
import {
  cliTestFailedText,
  type CliKeyStatus,
  type CliTierBadge,
  type InstanceCliMatrixRow,
  type PtahCliInstanceCell,
  type PtahCliInstanceOpenCell,
  type PtahCliInstanceToggle,
} from './cli-matrix-rows';
import {
  CLI_MATRIX_ACTION,
  CLI_MATRIX_CELL_BASE,
  CLI_MATRIX_DOT,
  CLI_MATRIX_FOCUS,
} from './cli-matrix-styles';
import { CliModelEffortPopoverComponent } from './cli-model-effort-popover.component';

/** The three tiers of an instance's mapping, in the tier modal's order. */
const TIERS: readonly Pick<CliTierBadge, 'tier' | 'label'>[] = [
  { tier: 'sonnet', label: 'Sonnet' },
  { tier: 'opus', label: 'Opus' },
  { tier: 'haiku', label: 'Haiku' },
];
/** Key status → badge fill; text stays base-content (deviation 6). */
const KEY_BADGE: Readonly<Record<CliKeyStatus['kind'], string>> = {
  'key-set': 'border-success/40 bg-success/10',
  keyless: 'border-base-content-muted/40 bg-base-300',
  missing: 'border-warning/40 bg-warning/10',
};
/** A card cell may take the card's full width (the table's cells cap at a column width). */
const CELL = `${CLI_MATRIX_CELL_BASE} max-w-full`;
const MENU_ITEM = `btn btn-ghost btn-sm w-full justify-start px-2 text-sm font-medium text-base-content ${CLI_MATRIX_FOCUS}`;
const LABEL = 'text-xs font-semibold uppercase tracking-wide text-base-content-muted';

/**
 * The Ptah CLI instances of the CLI matrix card, under the system CLI table and a hairline: what an instance is, a
 * clear Add, and one card per instance (on/off, name, provider, status, key status, model and effort, the three tier
 * models, the last Test, and Tiers / Test / More: Edit, Delete).
 *
 * Presentational: the matrix passes the rows and its busy / open / delete state, and owns every write, modal and focus
 * return through the outputs. Below 28rem Tiers and Test move into More (their `cli-matrix-more-*` items).
 */
@Component({
  selector: 'ptah-cli-instances',
  standalone: true,
  imports: [
    LucideAngularModule,
    NativePopoverComponent,
    ProviderMarkComponent,
    SettingsBusyDisabledDirective,
    CliModelEffortPopoverComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="space-y-3 border-t border-base-content/15 pt-4"
      aria-labelledby="cli-instances-heading"
      data-testid="cli-instances"
    >
      <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div class="min-w-0 flex-[1_1_18rem]">
          <h3
            id="cli-instances-heading"
            class="text-sm font-semibold text-base-content"
          >
            Ptah CLI instances
          </h3>
          <p class="mt-0.5 text-xs text-base-content-muted">
            Extra agent lanes that run through one of your connected providers (OpenRouter, Kimi Code, Z.AI and other
            Anthropic-compatible ones), each with its own model per tier.
          </p>
        </div>
        @if (!empty()) {
          <!-- Batch 32: opens the add-instance modal (#46-#49); focus returns here when it closes. -->
          <button
            type="button"
            [class]="'btn btn-outline btn-sm ml-auto shrink-0 gap-1.5 ' + focusRing"
            [disabled]="busy() || !canWrite()"
            (click)="addRequested.emit('header')"
            data-testid="cli-matrix-add"
          >
            <lucide-angular [img]="PlusIcon" class="h-4 w-4" aria-hidden="true" />
            Add Ptah CLI Instance
          </button>
        }
      </div>

      @if (empty()) {
        <!-- Plan §5 empty state: what an instance is for, and the one way to add it. -->
        <div
          class="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-base-content/10 p-4"
          data-testid="cli-matrix-no-instances"
        >
          <p class="min-w-0 flex-[1_1_16rem] text-sm text-base-content">
            No Ptah CLI instance yet.
            <span class="block text-xs text-base-content-muted"
              >Add one to give the orchestrator another lane on a provider you already connected.</span
            >
          </p>
          <button
            type="button"
            [class]="'btn btn-primary btn-sm shrink-0 gap-1.5 ' + focusRing"
            [disabled]="busy() || !canWrite()"
            (click)="addRequested.emit('empty')"
          >
            <lucide-angular [img]="PlusIcon" class="h-4 w-4" aria-hidden="true" />
            Add Ptah CLI Instance
          </button>
        </div>
      } @else {
        <ul class="space-y-2">
          @for (row of rows(); track row.id) {
            <li
              class="relative rounded-lg border border-base-content/10 p-3 hover:bg-base-content/5 has-[[role=dialog]]:z-30"
              [class.border-primary]="rowOpen(row.id)"
              [attr.data-testid]="'cli-matrix-row-' + row.id"
              data-kind="instance"
              [attr.data-dimmed]="row.interactive ? null : 'true'"
            >
              <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
                <input
                  type="checkbox"
                  [class]="'cli-check checkbox checkbox-primary checkbox-sm mt-0.5 ' + focusRing"
                  [checked]="row.enabled"
                  [ptahBusyDisabled]="busy() || !canWrite()"
                  [attr.aria-label]="row.name + ' enabled'"
                  (change)="toggled.emit({ row, event: $event })"
                  [attr.data-testid]="'cli-matrix-toggle-' + row.id"
                />
                <div class="min-w-0 flex-[1_1_12rem]">
                  <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span
                      class="text-sm font-semibold"
                      [class.text-base-content]="row.interactive"
                      [class.text-base-content-muted]="!row.interactive"
                      >{{ row.name }}</span
                    >
                    <span class="inline-flex min-w-0 items-center gap-1 text-xs text-base-content-muted">
                      <ptah-provider-mark [providerId]="row.providerId" fallback="Terminal" size="sm" />
                      <span class="truncate">{{ row.provider }}</span>
                    </span>
                  </div>
                  <div
                    class="mt-1 flex flex-wrap items-center gap-1"
                    data-testid="cli-matrix-instance-subline"
                  >
                    <span
                      class="badge badge-outline badge-sm gap-1 whitespace-nowrap border-base-300 text-xs font-medium text-base-content"
                      data-testid="cli-matrix-status"
                    >
                      <span [class]="'h-1.5 w-1.5 shrink-0 rounded-full ' + dot[row.status.tone]" aria-hidden="true"></span>
                      {{ row.status.label }}
                    </span>
                    <span
                      [class]="'badge badge-outline badge-sm whitespace-nowrap text-xs text-base-content ' + keyBadge[row.keyStatus.kind]"
                      data-testid="cli-matrix-key-status"
                      >{{ row.keyStatus.label }}</span
                    >
                  </div>
                </div>

                <div class="ml-auto flex shrink-0 items-center gap-1">
                  @if (confirmDeleteId() === row.id) {
                    <div
                      class="inline-flex flex-wrap items-center justify-end gap-1"
                      role="group"
                      [attr.aria-label]="'Delete ' + row.name"
                      [attr.data-testid]="'cli-matrix-delete-confirm-' + row.id"
                    >
                      <span class="text-xs text-base-content">Delete {{ row.name }}?</span>
                      <button
                        type="button"
                        [class]="action"
                        [ptahBusyDisabled]="busy() || !canWrite()"
                        (click)="deleteConfirmed.emit(row)"
                        [attr.aria-label]="'Confirm delete ' + row.name"
                      >
                        Delete
                      </button>
                      <button type="button" [class]="action" (click)="deleteCancelled.emit(row.id)" data-cancel-delete>
                        Cancel
                      </button>
                    </div>
                  } @else {
                    <button
                      type="button"
                      [class]="action + ' inst-inline-action'"
                      [disabled]="busy() || !canWrite()"
                      (click)="tiersRequested.emit(row)"
                      [attr.aria-label]="'Tiers for ' + row.name"
                      [attr.data-testid]="'cli-matrix-tiers-' + row.id"
                    >
                      Tiers
                    </button>
                    <button
                      type="button"
                      [class]="action + ' inst-inline-action'"
                      [ptahBusyDisabled]="testing()"
                      (click)="testRequested.emit(row.id)"
                      [attr.aria-label]="'Test ' + row.name"
                      [attr.data-testid]="'cli-matrix-test-' + row.id"
                    >
                      {{ testingId() === row.id ? 'Testing…' : 'Test' }}
                    </button>
                    <ptah-native-popover
                      [isOpen]="isOpen(row.id, 'more')"
                      placement="bottom-end"
                      [hasBackdrop]="true"
                      backdropClass="transparent"
                      (closed)="closed.emit()"
                      (opened)="moreOpened.emit()"
                    >
                      <button
                        trigger
                        type="button"
                        [class]="'btn btn-ghost btn-sm btn-square ' + focusRing"
                        [attr.aria-label]="'More actions for ' + row.name"
                        [attr.aria-expanded]="isOpen(row.id, 'more')"
                        (click)="cellToggled.emit({ rowId: row.id, kind: 'more' })"
                        [attr.data-testid]="'cli-matrix-more-' + row.id"
                      >
                        <lucide-angular [img]="MoreIcon" class="h-4 w-4" aria-hidden="true" />
                      </button>
                      @if (isOpen(row.id, 'more')) {
                        <div
                          content
                          role="group"
                          [attr.aria-label]="'More actions for ' + row.name"
                          class="flex w-40 flex-col p-1 text-left"
                          data-testid="cli-matrix-more-menu"
                        >
                          <button
                            type="button"
                            [class]="menuItem + ' inst-menu-action'"
                            [disabled]="busy() || !canWrite()"
                            (click)="closed.emit(); tiersRequested.emit(row)"
                            [attr.aria-label]="'Tiers for ' + row.name"
                            [attr.data-testid]="'cli-matrix-more-tiers-' + row.id"
                          >
                            Tiers
                          </button>
                          <button
                            type="button"
                            [class]="menuItem + ' inst-menu-action'"
                            [ptahBusyDisabled]="testing()"
                            (click)="closed.emit(); testRequested.emit(row.id)"
                            [attr.aria-label]="'Test ' + row.name"
                            [attr.data-testid]="'cli-matrix-more-test-' + row.id"
                          >
                            {{ testingId() === row.id ? 'Testing…' : 'Test' }}
                          </button>
                          <button
                            type="button"
                            [class]="menuItem"
                            [disabled]="busy() || !canWrite()"
                            (click)="editRequested.emit(row)"
                            [attr.aria-label]="'Edit ' + row.name + ' name or key'"
                            [attr.data-testid]="'cli-matrix-edit-' + row.id"
                          >
                            Edit name or key
                          </button>
                          <button
                            type="button"
                            [class]="menuItem"
                            [disabled]="busy() || !canWrite()"
                            (click)="deleteAsked.emit(row.id)"
                            [attr.aria-label]="'Delete ' + row.name"
                            [attr.data-testid]="'cli-matrix-delete-' + row.id"
                          >
                            Delete
                          </button>
                        </div>
                      }
                    </ptah-native-popover>
                  }
                </div>
              </div>

              <!-- Details: model and effort with the last Test, beside the three tier models (stacked in a narrow card). -->
              <div class="inst-details mt-3 grid gap-3 border-t border-base-300 pt-3">
                <div class="min-w-0 space-y-1.5">
                  <p [class]="label">Model</p>
                  <dl class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-xs">
                    <dt class="text-base-content-muted">Direct</dt>
                    <dd class="min-w-0">
                      @if (modelValue(row); as value) {
                        @if (row.interactive) {
                          <ptah-native-popover
                            [isOpen]="isOpen(row.id, 'model')"
                            placement="bottom-start"
                            [hasBackdrop]="true"
                            backdropClass="transparent"
                            (closed)="closed.emit()"
                            (opened)="cellOpened.emit()"
                          >
                            <button
                              trigger
                              type="button"
                              [class]="cell"
                              [ptahBusyDisabled]="busy()"
                              (click)="cellToggled.emit({ rowId: row.id, kind: 'model' })"
                              [attr.aria-label]="row.name + ' model: ' + value + '. Change'"
                              [attr.aria-expanded]="isOpen(row.id, 'model')"
                              [title]="row.selectedModel || null"
                              [attr.data-testid]="'cli-matrix-model-' + row.id"
                            >
                              <span class="line-clamp-2 break-words">{{ value }}</span>
                              <lucide-angular [img]="ChevronIcon" class="h-2.5 w-2.5 shrink-0 text-base-content-muted" aria-hidden="true" />
                            </button>
                            @if (isOpen(row.id, 'model')) {
                              <ptah-cli-model-effort-popover content [row]="row" field="model" (closed)="closed.emit()" />
                            }
                          </ptah-native-popover>
                        } @else {
                          <span class="line-clamp-2 break-words px-1.5 font-mono text-xs text-base-content-muted">{{ value }}</span>
                        }
                      } @else {
                        <span class="px-1.5 text-base-content-muted">Loading…</span>
                      }
                    </dd>
                    <dt class="text-base-content-muted">Effort</dt>
                    <dd class="min-w-0">
                      @if (row.interactive) {
                        <ptah-native-popover
                          [isOpen]="isOpen(row.id, 'effort')"
                          placement="bottom-start"
                          [hasBackdrop]="true"
                          backdropClass="transparent"
                          (closed)="closed.emit()"
                          (opened)="cellOpened.emit()"
                        >
                          <button
                            trigger
                            type="button"
                            [class]="cell"
                            [ptahBusyDisabled]="busy()"
                            (click)="cellToggled.emit({ rowId: row.id, kind: 'effort' })"
                            [attr.aria-label]="row.name + ' reasoning effort: ' + (row.effort || 'default') + '. Change'"
                            [attr.aria-expanded]="isOpen(row.id, 'effort')"
                            [attr.data-testid]="'cli-matrix-effort-' + row.id"
                          >
                            {{ row.effort || 'default' }}
                            <lucide-angular [img]="ChevronIcon" class="h-2.5 w-2.5 shrink-0 text-base-content-muted" aria-hidden="true" />
                          </button>
                          @if (isOpen(row.id, 'effort')) {
                            <ptah-cli-model-effort-popover content [row]="row" field="effort" (closed)="closed.emit()" />
                          }
                        </ptah-native-popover>
                      } @else {
                        <span class="px-1.5 font-mono text-xs text-base-content-muted">{{ row.effort || 'default' }}</span>
                      }
                    </dd>
                    <dt class="text-base-content-muted">Last test</dt>
                    <dd class="min-w-0 px-1.5 text-base-content" data-testid="cli-matrix-test-result">
                      {{ testText(row) }}
                    </dd>
                  </dl>
                </div>
                <div class="min-w-0 space-y-1.5">
                  <p [class]="label" [title]="tierList(row)" data-testid="cli-matrix-tier-summary">
                    Model tiers
                    <span class="font-normal normal-case tracking-normal">· {{ tierSummary(row) }}</span>
                  </p>
                  <ul class="grid grid-cols-3 gap-1.5">
                    @for (tier of tierSlots(row); track tier.tier) {
                      <li
                        class="min-w-0 rounded-md border border-base-content/10 px-2 py-1"
                        [attr.data-tier]="tier.tier"
                        [title]="tier.model ?? unsetTitle"
                      >
                        <span class="block text-xs font-medium text-base-content-muted">{{ tier.label }}</span
                        ><span class="sr-only">:</span>
                        <span
                          class="block break-all font-mono text-xs"
                          [class.text-base-content]="tier.model"
                          [class.text-base-content-muted]="!tier.model"
                          >{{ tier.model ?? 'Not set' }}</span
                        >
                      </li>
                    }
                  </ul>
                </div>
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      container-type: inline-size;
    }
    .inst-menu-action {
      display: none;
    }
    /* Model and effort beside the tier models once the card has room for both (1024 px Electron with the Workspaces
       panel open, glass included: about 36rem). */
    @container (min-width: 34rem) {
      .inst-details {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
      }
    }
    /* A very narrow box: Tiers and Test move into More. */
    @container (max-width: 27.99rem) {
      .inst-inline-action {
        display: none;
      }
      .inst-menu-action {
        display: inline-flex;
      }
    }
  `,
})
export class PtahCliInstancesComponent {
  protected readonly PlusIcon = Plus;
  protected readonly MoreIcon = Ellipsis;
  protected readonly ChevronIcon = ChevronDown;
  protected readonly focusRing = CLI_MATRIX_FOCUS;
  protected readonly cell = CELL;
  protected readonly action = CLI_MATRIX_ACTION;
  protected readonly menuItem = MENU_ITEM;
  protected readonly label = LABEL;
  protected readonly dot = CLI_MATRIX_DOT;
  protected readonly keyBadge = KEY_BADGE;
  protected readonly unsetTitle =
    "No model of its own: uses the provider's CLI-agent tier, else the provider default.";

  /** The instance rows, in the preferred order. */
  readonly rows = input.required<readonly InstanceCliMatrixRow[]>();
  /** The instance list is loaded and holds none. */
  readonly empty = input(false);
  readonly busy = input(false);
  readonly canWrite = input(false);
  readonly testing = input(false);
  readonly testingId = input<string | null>(null);
  readonly confirmDeleteId = input<string | null>(null);
  /** The matrix's one open popover (any row of the card). */
  readonly openCell = input<PtahCliInstanceOpenCell | null>(null);

  readonly addRequested = output<'header' | 'empty'>();
  readonly toggled = output<PtahCliInstanceToggle>();
  readonly cellToggled = output<{ readonly rowId: string; readonly kind: PtahCliInstanceCell }>();
  /** A model or effort popover is positioned: the matrix focuses its first control. */
  readonly cellOpened = output<void>();
  readonly moreOpened = output<void>();
  readonly closed = output<void>();
  readonly tiersRequested = output<InstanceCliMatrixRow>();
  readonly testRequested = output<string>();
  readonly editRequested = output<InstanceCliMatrixRow>();
  readonly deleteAsked = output<string>();
  readonly deleteCancelled = output<string>();
  readonly deleteConfirmed = output<InstanceCliMatrixRow>();

  protected isOpen(rowId: string, kind: PtahCliInstanceCell): boolean {
    const open = this.openCell();
    return open?.rowId === rowId && open.kind === kind;
  }

  protected rowOpen(rowId: string): boolean {
    return this.openCell()?.rowId === rowId;
  }

  /** The direct model; `''` = the tier mappings decide; null while the instance's saved model has not loaded. */
  protected modelValue(row: InstanceCliMatrixRow): string | null {
    return row.selectedModel === null
      ? null
      : row.selectedModel || 'provider default';
  }

  /** Every tier, mapped or not (null model = no model of its own). */
  protected tierSlots(
    row: InstanceCliMatrixRow,
  ): readonly { readonly tier: string; readonly label: string; readonly model: string | null }[] {
    return TIERS.map(({ tier, label }) => ({
      tier,
      label,
      model: row.tiers?.find((badge) => badge.tier === tier)?.model ?? null,
    }));
  }

  protected tierSummary(row: InstanceCliMatrixRow): string {
    if (row.tiers === null) return 'loading';
    return row.tiers.length ? `${row.tiers.length} of ${TIERS.length} set` : 'none set';
  }

  protected tierList(row: InstanceCliMatrixRow): string {
    return (
      (row.tiers ?? []).map((tier) => `${tier.label}: ${tier.model}`).join(', ') ||
      'No tier models'
    );
  }

  /** This instance's last Test as the state reports it (S1: a new run drops the previous result). */
  protected testText(row: InstanceCliMatrixRow): string {
    if (!row.lastTest) return 'Not run yet';
    if (row.lastTest.success)
      return row.lastTest.latencyMs === null
        ? 'Passed'
        : `Passed in ${row.lastTest.latencyMs}ms`;
    return cliTestFailedText(row.lastTest.reason);
  }
}

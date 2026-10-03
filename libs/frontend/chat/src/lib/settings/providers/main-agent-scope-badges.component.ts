import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { NativePopoverComponent } from '@ptah-extension/ui';
import type { ScopedSettingEntry, SettingScope } from '@ptah-extension/shared';
import { SettingScopeRowComponent, scopeBadgeLook, scopeBadgeShown } from './setting-scope-row.component';
import { injectAppScopeName } from './app-scope-label';

/** One Main Agent field that may carry a D16 scope badge. */
export interface MainAgentScopeField {
  /** The settings key a clear targets. */
  readonly key: string;
  /** Full field name: the field badge's popover title and every accessible name (D16). */
  readonly fieldName: string;
  /** Field badge text before " · {scope}" ("Effort", "Authentication", "Provider"). */
  readonly shortFieldName: string;
  readonly entry: ScopedSettingEntry;
  readonly supportedTargets: readonly SettingScope[];
  /** Pre-formatted value shown in "Will use … from …" (authentication), else the raw fallback. */
  readonly fallbackValueLabel: string | null;
  readonly disabled: boolean;
}

export interface MainAgentScopeClear {
  readonly key: string;
  readonly target: 'nearest' | 'all-above-global';
}

interface ScopeLayerGroup {
  readonly scope: SettingScope;
  /** "App override" in the prototype: the App layer is named after the running host (Batch 27b). */
  readonly label: string;
  readonly fields: readonly MainAgentScopeField[];
}

/** Prototype order: App, then Workspace (Global overrides, rare, first). */
const LAYER_ORDER: readonly SettingScope[] = ['global', 'app', 'workspace'];

/**
 * The Main Agent node's D16 scope badges, one per scope layer (TASK_2026_555 Batch 52.6; prototype
 * `index-anubis-1024x768.png`: "App override" and "Workspace override" beside the title). Live profiles override the
 * effort, authentication and provider in different layers. One badge per field stacked three rows deep, and the "+N"
 * variant (52.3) truncated the first badge to "Eff…". A layer badge ("VS Code override", "Desktop app override",
 * "Workspace override") is never truncated. Its popover lists the fields overridden in that layer as the field badges
 * ("Effort · App"), each with its own layers and clear actions, so every D16 field name and action stays reachable. An
 * inherited field shows nothing (RUX-6).
 */
@Component({
  selector: 'ptah-main-agent-scope-badges',
  standalone: true,
  imports: [LucideAngularModule, NativePopoverComponent, SettingScopeRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The layer badges are items of the node head's own row, so they can wrap under the title when the node is narrow.
  host: { class: 'contents' },
  template: `
    @for (group of groups(); track group.scope) {
      <ptah-native-popover [isOpen]="openLayer() === group.scope" placement="bottom-start" [hasBackdrop]="true"
        backdropClass="transparent" (closed)="openLayer.set(null)">
        <button trigger type="button" [class]="look(group.scope).tone + ' whitespace-nowrap'" aria-haspopup="dialog"
          [attr.aria-expanded]="openLayer() === group.scope" [attr.aria-label]="layerAriaLabel(group)"
          (click)="toggle(group.scope)" data-testid="main-scope-layer" [attr.data-layer]="group.scope"
          [attr.data-fields]="fieldNames(group)">
          @if (look(group.scope).icon; as icon) {
            <lucide-angular [img]="icon" [class]="look(group.scope).iconTone" aria-hidden="true" />
          }
          {{ group.label }}
        </button>
        <div content role="dialog" [attr.aria-label]="group.label" class="w-max max-w-[18rem] space-y-2 p-2.5 text-xs"
          data-testid="main-scope-layer-popover">
          <p class="font-semibold text-base-content">{{ group.label }}</p>
          <ul class="flex flex-col items-start gap-1.5">
            @for (field of group.fields; track field.key) {
              <li>
                <ptah-setting-scope-row [fieldName]="field.fieldName" [shortFieldName]="field.shortFieldName" [scope]="field.entry.scope"
                  [hasOverride]="field.entry.hasOverride" [supportedTargets]="field.supportedTargets" [workspaceName]="workspaceName()"
                  [fallbackPreview]="field.entry.fallbackPreview" [credentialSource]="field.entry.credentialSource"
                  [fallbackValueLabel]="field.fallbackValueLabel" [hasIntermediateAppLayer]="field.entry.fallbackPreview?.scope === 'app'"
                  [disabled]="field.disabled" (clearRequested)="clear(field.key, 'nearest')"
                  (useGlobalRequested)="clear(field.key, 'all-above-global')" />
              </li>
            }
          </ul>
        </div>
      </ptah-native-popover>
    }
  `,
})
export class MainAgentScopeBadgesComponent {
  private readonly appScope = injectAppScopeName();

  readonly fields = input<readonly MainAgentScopeField[]>([]);
  readonly workspaceName = input<string | null>(null);
  readonly clearRequested = output<MainAgentScopeClear>();

  protected readonly openLayer = signal<SettingScope | null>(null);
  protected readonly look = scopeBadgeLook;

  /** Fields that render a badge, grouped by the layer that wins for them; layers without one are left out. */
  protected readonly groups = computed<readonly ScopeLayerGroup[]>(() => {
    const shown = this.fields().filter((field) => scopeBadgeShown(field.entry.scope, field.entry.hasOverride));
    return LAYER_ORDER
      .map((scope) => ({ scope, label: this.layerLabel(scope), fields: shown.filter((field) => field.entry.scope === scope) }))
      .filter((group) => group.fields.length > 0);
  });

  protected toggle(scope: SettingScope): void {
    this.openLayer.set(this.openLayer() === scope ? null : scope);
  }

  protected fieldNames(group: ScopeLayerGroup): string {
    return group.fields.map((field) => field.fieldName).join('|');
  }

  protected layerAriaLabel(group: ScopeLayerGroup): string {
    return `${group.label}: ${group.fields.map((field) => field.fieldName).join(', ')}`;
  }

  /** Closes the layer popover; the field badge's own popover already closed and the host reviews the clear. */
  protected clear(key: string, target: MainAgentScopeClear['target']): void {
    this.openLayer.set(null);
    this.clearRequested.emit({ key, target });
  }

  private layerLabel(scope: SettingScope): string {
    if (scope === 'app') return `${this.appScope.label} override`;
    if (scope === 'workspace') return 'Workspace override';
    return 'Global override';
  }
}

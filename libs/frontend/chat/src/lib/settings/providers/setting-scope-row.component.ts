import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, Cpu, Folder } from 'lucide-angular';
import type { LucideIconData } from 'lucide-angular';
import type { SettingScope } from '@ptah-extension/shared';
import { NativePopoverComponent } from '@ptah-extension/ui';

/**
 * Source of one setting's effective value. `'mixed'` marks a group of fields that does not share one
 * scope, or a value whose source is not known: the badge then says **Mixed sources** instead of a
 * guessed scope.
 */
export type SettingScopeDisplay = SettingScope | 'mixed';

/** Credential source discriminator from `ScopedSettingEntry`. */
export type CredentialSource =
  | 'machine-secret-store'
  | 'host-supplied'
  | 'not-a-secret';

/** Fallback preview carried by `ScopedSettingEntry.fallbackPreview`. */
export interface ScopeFallbackPreview {
  scope: SettingScope;
  value: unknown;
}

interface ScopeLayer {
  readonly scope: SettingScope;
  readonly label: string;
  readonly note: string;
  readonly active: boolean;
}

interface BadgeView {
  readonly text: string;
  readonly icon: LucideIconData | null;
  readonly tone: string;
  readonly iconTone: string;
}

const LAYER_ORDER: readonly SettingScope[] = ['global', 'app', 'workspace'];
const ACTION =
  'btn btn-ghost btn-sm min-h-9 w-full justify-start text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/**
 * Scope badge for one settings field (design-spec §3.2, plan D16). Same selector, inputs and outputs as
 * the old always-visible scope strip; the template is now:
 * - **nothing** while the value is inherited (`hasOverride` false), so a page shows provenance only
 *   where a narrower layer wins (RUX-6);
 * - a badge "{short field} · {Workspace|App}" for an override, with `data-testid="scope-badge"` and
 *   `data-field` naming the field it governs (D16); a neutral "{short field} · Mixed sources" badge
 *   when the source is mixed or unknown (never a guessed scope);
 * - a popover (`NativePopoverComponent`, transparent backdrop) headed by the full field name, with the
 *   Global / App / Workspace layers and the existing Clear override / Use global value / Copy global
 *   actions, which still only emit: the host owns the review-then-confirm and every write.
 *
 * Colour sits on the badge border, fill and icon only; text stays `text-base-content` (deviation 6).
 * `overrideRequested` and `defaultLabel` stay in the API, but an inherited value renders no control:
 * the host offers its own "Save to" targets instead (RUX-5).
 */
@Component({
  selector: 'ptah-setting-scope-row',
  standalone: true,
  imports: [LucideAngularModule, NativePopoverComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (badge(); as view) {
      <!-- bottom-start: the prototype anchors the popover at the badge's left edge (openScopePopover). -->
      <ptah-native-popover [isOpen]="open()" placement="bottom-start" [hasBackdrop]="true" backdropClass="transparent"
        (closed)="open.set(false)">
        <button trigger type="button" [class]="view.tone" data-testid="scope-badge" [attr.data-field]="fieldName()"
          aria-haspopup="dialog" [attr.aria-expanded]="open()" (click)="open.set(!open())">
          @if (view.icon; as icon) {
            <lucide-angular [img]="icon" [class]="view.iconTone" aria-hidden="true" />
          }
          {{ view.text }}<span class="sr-only">, {{ fieldName() }} scope details</span>
        </button>
        <div content role="dialog" [attr.aria-label]="fieldName() + ' scope'" class="w-72 space-y-3 p-3 text-xs"
          data-testid="scope-popover">
          <p class="border-b border-base-300 pb-1.5 font-semibold text-base-content" data-testid="scope-popover-title">
            {{ fieldName() }}
          </p>
          @if (scope() === 'mixed') {
            <p class="text-base-content" data-testid="scope-mixed-note">
              These values come from more than one scope, or their source is not known.
            </p>
          }
          <ul class="space-y-1" aria-label="Where this value can be set">
            @for (layer of layers(); track layer.scope) {
              <li [attr.data-layer]="layer.scope" [attr.aria-current]="layer.active ? 'true' : null"
                [class]="layer.active
                  ? 'flex items-center justify-between gap-2 rounded border border-primary/30 bg-primary/10 px-2 py-1 font-semibold text-base-content'
                  : 'flex items-center justify-between gap-2 px-2 py-1 text-base-content-muted'">
                <span class="min-w-0 break-words">{{ layer.label }}</span>
                @if (layer.note) { <span class="shrink-0 text-base-content">{{ layer.note }}</span> }
              </li>
            }
          </ul>
          @if (clearPreviewText(); as preview) {
            <p class="text-base-content-muted" data-testid="scope-clear-preview">{{ preview }}</p>
          }
          @if (credentialLine(); as line) {
            <p class="text-base-content-muted" data-testid="scope-credential">{{ line }}</p>
          }
          @if (canClear()) {
            <div class="space-y-1 border-t border-base-300 pt-2">
              <button type="button" [class]="action" [attr.aria-label]="'Clear override: ' + fieldName()" [disabled]="disabled()"
                (click)="emit(clearRequested)" data-testid="scope-clear-override">Clear override</button>
              @if (hasIntermediateAppLayer()) {
                <button type="button" [class]="action" [attr.aria-label]="'Use global value: ' + fieldName()" [disabled]="disabled()"
                  (click)="emit(useGlobalRequested)" data-testid="scope-use-global">Use global value</button>
              }
              @if (showCopyGlobal()) {
                <button type="button" [class]="action" [attr.aria-label]="'Copy global value to this workspace: ' + fieldName()"
                  [disabled]="disabled()" (click)="emit(copyGlobalRequested)" data-testid="scope-copy-global">
                  Copy global value to this workspace
                </button>
              }
            </div>
          }
          @if (disabled() && disabledReason(); as reason) {
            <p class="text-base-content-muted" data-testid="scope-disabled-reason">{{ reason }}</p>
          }
        </div>
      </ptah-native-popover>
    }
  `,
})
export class SettingScopeRowComponent {
  protected readonly action = ACTION;

  /** Full field name: the popover header, `data-field`, and every action's accessible name (D16). */
  readonly fieldName = input<string>('');

  /** Short field name for the badge text ("Effort · Workspace"); falls back to `fieldName`. */
  readonly shortFieldName = input<string | null>(null);

  /** Winning scope of the current value, or `'mixed'` for a mixed group or an unknown source. */
  readonly scope = input<SettingScopeDisplay | null>(null);

  /** True when the winning layer is an override rather than the deepest stored base. */
  readonly hasOverride = input<boolean>(false);

  /** Write targets the backend supports for this key. `['global']` hides every clear action. */
  readonly supportedTargets = input<readonly SettingScope[]>([]);

  /** DTO preview of what a clear would reveal. */
  readonly fallbackPreview = input<ScopeFallbackPreview | null>(null);

  /** Parent-preformatted fallback value copy, rendered verbatim when set. */
  readonly fallbackValueLabel = input<string | null>(null);

  /** Workspace name used in the Workspace layer and the workspace fallback preview. */
  readonly workspaceName = input<string | null>(null);

  /** True when the workspace source is cross-app. */
  readonly workspaceCrossApp = input<boolean>(false);

  /** Kept for API stability: nothing renders while a value is inherited, so no default copy shows. */
  readonly defaultLabel = input<string | null>(null);

  /** Credential provenance from `ScopedSettingEntry.credentialSource`. */
  readonly credentialSource = input<CredentialSource | null>(null);

  /** Host-supplied credential description; overrides the default credential copy. */
  readonly credentialDescription = input<string | null>(null);

  /** True when an intermediate App layer remains beneath the workspace override. */
  readonly hasIntermediateAppLayer = input<boolean>(false);

  /** True when the host offers **Copy global value to this workspace** here. */
  readonly showCopyGlobal = input<boolean>(false);

  /** True while the host commits or cannot commit an action: the badge stays, its actions are disabled. */
  readonly disabled = input<boolean>(false);

  /** Explanatory copy kept visible beside disabled actions. */
  readonly disabledReason = input<string | null>(null);

  /** Kept for API stability; an inherited value renders no control, so this is not emitted here. */
  readonly overrideRequested = output<void>();

  /** The user asked to clear the winning override (`target: 'nearest'`). */
  readonly clearRequested = output<void>();

  /** The user asked to return to the global value (`target: 'all-above-global'`). */
  readonly useGlobalRequested = output<void>();

  /** The user asked to copy the global value into this workspace. */
  readonly copyGlobalRequested = output<void>();

  protected readonly open = signal(false);

  protected readonly badge = computed<BadgeView | null>(() => {
    const scope = this.scope();
    const name = this.shortFieldName() || this.fieldName();
    const base =
      'badge badge-sm h-auto min-h-6 gap-1 px-2 py-0.5 font-semibold text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
    if (scope === 'mixed') {
      return { text: `${name} · Mixed sources`, icon: null, iconTone: '', tone: `${base} badge-outline border-base-content-muted bg-base-100` };
    }
    if (!this.hasOverride() || scope === null) return null;
    if (scope === 'app') {
      return { text: `${name} · App`, icon: Cpu, iconTone: 'h-3 w-3 text-info', tone: `${base} border-info/40 bg-info/10` };
    }
    if (scope === 'workspace') {
      return { text: `${name} · Workspace`, icon: Folder, iconTone: 'h-3 w-3 text-secondary', tone: `${base} border-secondary/40 bg-secondary/10` };
    }
    return { text: `${name} · Global`, icon: null, iconTone: '', tone: `${base} badge-outline border-base-content-muted bg-base-100` };
  });

  /** Global, then App and Workspace where they can hold this value; the winning layer is marked. */
  protected readonly layers = computed<readonly ScopeLayer[]>(() => {
    const scope = this.scope();
    const fallback = this.fallbackPreview()?.scope ?? null;
    const targets = this.supportedTargets();
    return LAYER_ORDER
      .filter((layer) => layer === 'global' || targets.includes(layer) || layer === scope || layer === fallback)
      .map((layer) => ({
        scope: layer,
        label: this.layerLabel(layer),
        active: layer === scope,
        note: layer === scope ? 'In use' : layer === fallback ? 'Used after clear' : '',
      }));
  });

  private readonly isGlobalOnly = computed<boolean>(() => {
    const targets = this.supportedTargets();
    return targets.length === 1 && targets[0] === 'global';
  });

  protected readonly canClear = computed<boolean>(
    () => !this.isGlobalOnly() && this.hasOverride() && this.scope() !== 'mixed',
  );

  /** Copy shown beside **Clear override**, before the action is taken. */
  protected readonly clearPreviewText = computed<string | null>(() => {
    const preview = this.fallbackPreview();
    if (!preview || !this.canClear()) return null;
    const value = this.fallbackValueLabel() ?? formatFallbackValue(preview.value);
    return `Will use ${value} from ${fallbackSourceLabel(preview.scope, this.workspaceName())}.`;
  });

  protected readonly credentialLine = computed<string | null>(() => {
    const source = this.credentialSource();
    if (source === 'machine-secret-store') {
      return this.credentialDescription() ?? 'Credential: stored on this machine';
    }
    if (source === 'host-supplied') {
      return this.credentialDescription() ?? 'Credential: provided by the host';
    }
    return null;
  });

  /** Closes the popover (focus returns to the badge) and hands the intent to the host's review. */
  protected emit(target: { emit(value: void): void }): void {
    this.open.set(false);
    target.emit();
  }

  private layerLabel(layer: SettingScope): string {
    if (layer === 'global') return 'Global · all Ptah apps';
    if (layer === 'app') return 'Desktop app';
    const name = this.workspaceName();
    if (!name) return 'This workspace';
    return `Workspace · ${name}${this.workspaceCrossApp() ? ' (All Ptah apps)' : ''}`;
  }
}

/** Renders a raw fallback value only when it is a displayable primitive. */
function formatFallbackValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return 'the previous value';
}

function fallbackSourceLabel(
  scope: SettingScope,
  workspaceName: string | null,
): string {
  if (scope === 'global') return 'Global';
  if (scope === 'app') return 'the Desktop app';
  return workspaceName ? `Workspace ${workspaceName}` : 'Workspace';
}

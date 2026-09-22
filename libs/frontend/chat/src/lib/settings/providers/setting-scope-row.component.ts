import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, Cpu, Folder, Globe } from 'lucide-angular';
import type { LucideIconData } from 'lucide-angular';
import type { SettingScope } from '@ptah-extension/shared';

/**
 * Source of one setting's effective value, as `design-spec.md`'s
 * "Scope affordance spec" requires it to be shown. `'mixed'` marks a group of
 * fields that does not share one scope — the row then shows **Mixed sources**
 * instead of a guessed group scope.
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

const FALLBACK_BADGE_TEXT = 'App default · Not configured';

/**
 * Presentational scope row for one settings field
 * (`design-spec.md` "Scope affordance spec", component inventory row for
 * `SettingScopeRowComponent`).
 *
 * Shows where a field's current value comes from, offers an override action
 * and a clear action where the backend supports those targets, and previews
 * what a clear would change before it is taken. Every intent is emitted
 * through an output — this component performs no RPC call and owns no
 * persistence. The host composition owns the "Save to" radio group, the
 * inline reviews for Use global value, and save/clear state copy
 * (**Saving…** / "Saved to {scope}." / "Could not save.").
 *
 * Rules honoured here:
 * - `supportedTargets` `['global']` hides every override and clear control —
 *   scope is generic for reads but honest about writes.
 * - A fallback value is rendered from `fallbackValueLabel` when the host
 *   supplies one, because raw stored values such as the stored auth method
 *   are diagnostic data and must never be rendered (implementation plan,
 *   Decision 1). Without it, primitive values render as-is and anything
 *   else renders as "the previous value".
 * - Credentials stay separate from scope: a scope strip never claims that a
 *   workspace override relocates a secret.
 */
@Component({
  selector: 'ptah-setting-scope-row',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-wrap items-center gap-2 rounded-md bg-base-100 px-2 py-1 text-xs"
      data-testid="setting-scope-row"
    >
      <span
        class="badge badge-outline text-xs font-medium gap-1 bg-base-100 text-base-content border-base-content-muted"
        data-testid="scope-source-badge"
      >
        @if (sourceBadge().icon; as icon) {
          <lucide-angular [img]="icon" class="h-3 w-3" aria-hidden="true" />
        }
        {{ sourceBadge().text }}
      </span>

      @if (canClear()) {
        <button
          type="button"
          class="btn btn-ghost btn-sm min-h-9 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          [attr.aria-label]="clearAriaLabel()"
          [disabled]="disabled()"
          (click)="clearRequested.emit()"
          data-testid="scope-clear-override"
        >
          Clear override
        </button>
        @if (hasIntermediateAppLayer()) {
          <button
            type="button"
            class="btn btn-ghost btn-sm min-h-9 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
            [attr.aria-label]="useGlobalAriaLabel()"
            [disabled]="disabled()"
            (click)="useGlobalRequested.emit()"
            data-testid="scope-use-global"
          >
            Use global value
          </button>
        }
        @if (showCopyGlobal()) {
          <button
            type="button"
            class="btn btn-ghost btn-sm min-h-9 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
            [attr.aria-label]="copyGlobalAriaLabel()"
            [disabled]="disabled()"
            (click)="copyGlobalRequested.emit()"
            data-testid="scope-copy-global"
          >
            Copy global value to this workspace
          </button>
        }
        @if (clearPreviewText(); as preview) {
          <span
            class="text-base-content-muted"
            data-testid="scope-clear-preview"
            >{{ preview }}</span
          >
        }
      } @else if (canOverride()) {
        <button
          type="button"
          class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          [attr.aria-label]="overrideAriaLabel()"
          [disabled]="disabled()"
          (click)="overrideRequested.emit()"
          data-testid="scope-override"
        >
          {{ overrideLabel() }}
        </button>
      }

      @if (credentialLine(); as line) {
        <span class="text-base-content-muted" data-testid="scope-credential">{{
          line
        }}</span>
      }

      @if (disabled() && disabledReason(); as reason) {
        <span
          class="text-base-content-muted"
          data-testid="scope-disabled-reason"
          >{{ reason }}</span
        >
      }
    </div>
  `,
})
export class SettingScopeRowComponent {
  protected readonly GlobeIcon = Globe;
  protected readonly CpuIcon = Cpu;
  protected readonly FolderIcon = Folder;

  /** Human field name included in button accessible names, where buttons repeat labels. */
  readonly fieldName = input<string>('');

  /** Winning scope of the current value, or `'mixed'` for a mixed group. */
  readonly scope = input<SettingScopeDisplay | null>(null);

  /** True when the winning layer is an override rather than the deepest stored base. */
  readonly hasOverride = input<boolean>(false);

  /** Write targets the backend supports for this key. Unknown targets hide the actions. */
  readonly supportedTargets = input<readonly SettingScope[]>([]);

  /** DTO preview of what a clear would reveal. */
  readonly fallbackPreview = input<ScopeFallbackPreview | null>(null);

  /** Parent-preformatted fallback value copy, rendered verbatim when set. */
  readonly fallbackValueLabel = input<string | null>(null);

  /** Workspace name used in the Workspace badge and workspace fallback preview. */
  readonly workspaceName = input<string | null>(null);

  /** True when the workspace source is cross-app. */
  readonly workspaceCrossApp = input<boolean>(false);

  /** Copy shown when nothing is stored. Defaults to "App default · Not configured". */
  readonly defaultLabel = input<string | null>(null);

  /** Credential provenance from `ScopedSettingEntry.credentialSource`. */
  readonly credentialSource = input<CredentialSource | null>(null);

  /** Host-supplied credential description; overrides the default credential copy. */
  readonly credentialDescription = input<string | null>(null);

  /** True when an intermediate App layer remains beneath the workspace override. */
  readonly hasIntermediateAppLayer = input<boolean>(false);

  /** True when the host offers **Copy global value to this workspace** here. */
  readonly showCopyGlobal = input<boolean>(false);

  /** True while the host commits or cannot commit an action. */
  readonly disabled = input<boolean>(false);

  /** Explanatory copy kept visible beside disabled controls. */
  readonly disabledReason = input<string | null>(null);

  /** The user asked to override the inherited value. */
  readonly overrideRequested = output<void>();

  /** The user asked to clear the winning override (`target: 'nearest'`). */
  readonly clearRequested = output<void>();

  /** The user asked to return to the global value (`target: 'all-above-global'`). */
  readonly useGlobalRequested = output<void>();

  /** The user asked to copy the global value into this workspace. */
  readonly copyGlobalRequested = output<void>();

  private readonly isGlobalOnly = computed<boolean>(() => {
    const targets = this.supportedTargets();
    return targets.length === 1 && targets[0] === 'global';
  });

  /** Override control exists only for inherited values with a non-global write target. */
  protected readonly canOverride = computed<boolean>(() => {
    const targets = this.supportedTargets();
    return (
      !this.isGlobalOnly() &&
      !this.hasOverride() &&
      this.scope() !== 'mixed' &&
      targets.length > 0
    );
  });

  protected readonly canClear = computed<boolean>(
    () => !this.isGlobalOnly() && this.hasOverride(),
  );

  protected readonly overrideLabel = computed<string>(() => {
    const targets = this.supportedTargets();
    return targets.includes('workspace')
      ? 'Override for this workspace'
      : 'Override for this app';
  });

  protected readonly sourceBadge = computed<{
    icon: LucideIconData | null;
    text: string;
  }>(() => {
    const scope = this.scope();
    if (scope === 'mixed') return { icon: null, text: 'Mixed sources' };
    if (scope === null) {
      return { icon: null, text: this.defaultLabel() ?? FALLBACK_BADGE_TEXT };
    }
    if (scope === 'global') {
      return { icon: Globe, text: 'From Global · All Ptah apps' };
    }
    if (scope === 'app') {
      return { icon: Cpu, text: 'From App · Desktop' };
    }
    const workspace = this.workspaceName() ?? 'workspace';
    const suffix = this.workspaceCrossApp()
      ? '(All Ptah apps)'
      : '(Desktop)';
    return {
      icon: Folder,
      text: `From Workspace · ${workspace} ${suffix}`,
    };
  });

  /** Copy shown beside **Clear override**, before the action is taken. */
  protected readonly clearPreviewText = computed<string | null>(() => {
    const preview = this.fallbackPreview();
    if (!preview) return null;
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

  protected readonly overrideAriaLabel = computed<string>(() =>
    this.ariaLabelWith(this.overrideLabel()),
  );

  protected readonly clearAriaLabel = computed<string>(() =>
    this.ariaLabelWith('Clear override'),
  );

  protected readonly useGlobalAriaLabel = computed<string>(() =>
    this.ariaLabelWith('Use global value'),
  );

  protected readonly copyGlobalAriaLabel = computed<string>(() =>
    this.ariaLabelWith('Copy global value to this workspace'),
  );

  private ariaLabelWith(action: string): string {
    const field = this.fieldName();
    return field ? `${action}: ${field}` : action;
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
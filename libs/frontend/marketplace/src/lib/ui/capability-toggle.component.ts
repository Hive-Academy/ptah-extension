import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  CAPABILITY_ENFORCEMENT,
  PTAH_MCP_SERVER_NAME,
  type CapabilityDefaultReason,
  type CapabilityEntry,
  type CapabilityScope,
} from '@ptah-extension/shared';

/** Colour family of a badge. Every badge carries a word, never colour alone. */
type CapabilityBadgeTone = 'info' | 'warning' | 'neutral';

/** One badge next to a capability toggle. */
export interface CapabilityBadge {
  readonly id:
    | 'new-workspace-server'
    | 'imported'
    | 'parent-off'
    | 'unknown'
    | 'override'
    | 'inheriting';
  readonly label: string;
  /** Longer text for the tooltip and the control's description. */
  readonly detail: string;
  readonly tone: CapabilityBadgeTone;
}

/** Per-tone classes, kept as whole strings so Tailwind can see them. */
const BADGE_TONE_CLASSES: Readonly<Record<CapabilityBadgeTone, string>> = {
  info: 'border-info/40 bg-info/10 text-info',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  neutral: 'border-base-300 bg-base-200/60 text-base-content-muted',
};

/** The scope-of-write text shown next to every toggle (AC-2.2). */
export const CAPABILITY_SCOPE_TEXT: Readonly<Record<CapabilityScope, string>> =
  {
    workspace: 'This workspace only',
    global: 'All workspaces',
  };

/** AC-4.9: a toggle changes the next session, never one already running. */
export const NEXT_SESSION_NOTE = 'Changes apply to the next session.';

/** AC-4.6: what goes away with Ptah's own server. */
export const PTAH_OFF_WARNING =
  'Ptah tools are off: agent lanes, memory and browser tools will be unavailable in new sessions.';

/**
 * The badges for one row, in display order. Pure, so a list view can reuse the
 * same words.
 *
 * - `unknown`: the policy is unreadable, so the effective value is not known.
 * - `parent-off`: a skill whose plugin is off is off whatever it says itself.
 * - `new-workspace-server`: declared only by this repository's files and not
 *   yet decided — OFF until the user turns it on.
 * - `imported`: the value came from the user's own Claude approvals.
 * - `override` / `inheriting`: whether this workspace records its own value or
 *   follows the global one (AC-2.4).
 */
export function capabilityBadges(
  entry: CapabilityEntry,
  scope: CapabilityScope,
): CapabilityBadge[] {
  const badges: CapabilityBadge[] = [];
  if (entry.effectiveEnabled === null) {
    badges.push({
      id: 'unknown',
      label: 'Unknown',
      detail:
        "Ptah couldn't read the capability settings, so this item's state is unknown.",
      tone: 'warning',
    });
  }
  switch (entry.inheritedFrom) {
    case 'parent-plugin':
      badges.push({
        id: 'parent-off',
        label: 'Plugin off',
        detail: `Off because its plugin${entry.parentId ? ` ${entry.parentId}` : ''} is off.`,
        tone: 'neutral',
      });
      break;
    case 'imported':
      badges.push({
        id: 'imported',
        label: 'Imported',
        detail: 'Set from your Claude approvals for this project.',
        tone: 'neutral',
      });
      break;
    case 'workspace':
      badges.push({
        id: 'override',
        label: 'Workspace override',
        detail:
          scope === 'workspace'
            ? 'This workspace overrides the global setting.'
            : 'This workspace overrides the global setting, so a global change does not apply here.',
        tone: 'info',
      });
      break;
    case 'default':
      if (entry.defaultReason === 'repository-only') {
        badges.push({
          id: 'new-workspace-server',
          label: 'New in this workspace',
          detail:
            "Declared by this repository's files. Off until you turn it on.",
          tone: 'warning',
        });
        break;
      }
      pushInheriting(badges, scope);
      break;
    case 'global':
      pushInheriting(badges, scope);
      break;
    default: {
      // A new origin must be given its badge here: this fails to compile until
      // it is. At runtime an origin newer than this build adds no badge rather
      // than breaking the row.
      const unhandled: never = entry.inheritedFrom;
      void unhandled;
    }
  }
  return badges;
}

/** A workspace control that follows the global value says so. */
function pushInheriting(
  badges: CapabilityBadge[],
  scope: CapabilityScope,
): void {
  if (scope !== 'workspace') return;
  badges.push({
    id: 'inheriting',
    label: 'Follows global',
    detail: 'This workspace uses the global setting.',
    tone: 'neutral',
  });
}

/**
 * The provider labels that do not yet enforce toggles of this kind, read from
 * `CAPABILITY_ENFORCEMENT` only (AC-4.8, A-UI): when a provider starts
 * enforcing, its row flips there and the label disappears here with no edit.
 */
export function notEnforcedProviders(
  entry: Pick<CapabilityEntry, 'kind'>,
): string[] {
  return CAPABILITY_ENFORCEMENT.filter(
    (row) => row.kind === entry.kind && row.status === 'not-enforced',
  ).map((row) => row.label);
}

/** Per-instance suffix for the description ids. */
let nextToggleId = 0;

/**
 * One capability's on/off switch: the control, the scope it writes to, its
 * badges, the enforcement gaps for its kind and the next-session note.
 *
 * Presentational: the page owns the store and passes the row, whether a write
 * is in flight and the row's last error; the control emits the value the user
 * asked for.
 *
 * The switch is a native checkbox, so Space toggles it and Tab reaches it with
 * no extra wiring. Its accessible name carries the item name, its state and the
 * scope it writes to (AC-1.5, AC-2.2); the scope, badges and notes are its
 * description. It shows the value of its own scope
 * ({@link capabilityControlState}): a workspace control the effective value
 * here, a global control the value every workspace inherits. Indeterminate
 * when that value cannot be known.
 *
 * @example
 * ```html
 * <ptah-capability-toggle
 *   [entry]="entry"
 *   scope="workspace"
 *   [pending]="store.isPending(entry)"
 *   [error]="store.errorFor(entry)"
 *   (toggled)="store.setEnabled(entry, 'workspace', $event)"
 * />
 * ```
 */
@Component({
  selector: 'ptah-capability-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <div class="flex min-w-0 flex-col gap-1" data-testid="capability-toggle">
      <label class="flex min-h-9 min-w-0 cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          class="toggle toggle-sm toggle-primary shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          data-testid="capability-toggle-input"
          [checked]="checked()"
          [indeterminate]="indeterminate()"
          [disabled]="pending()"
          [attr.aria-label]="accessibleName()"
          [attr.aria-describedby]="descriptionId"
          [attr.aria-busy]="pending() ? 'true' : null"
          (change)="onChange($event)"
        />
        <span class="truncate text-sm text-base-content" aria-hidden="true">{{
          entry().label
        }}</span>
      </label>

      <div
        [id]="descriptionId"
        class="flex min-w-0 flex-col gap-1 text-[11px] leading-snug text-base-content-muted"
      >
        <p data-testid="capability-toggle-scope">
          <span class="font-medium text-base-content">{{ scopeText() }}</span>
          <span aria-hidden="true"> · </span>
          <span>{{ nextSessionNote }}</span>
        </p>

        @if (badges().length > 0) {
          <ul class="flex flex-wrap gap-1" aria-label="Status">
            @for (badge of badges(); track badge.id) {
              <li
                class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
                [class]="badgeClass(badge)"
                [attr.data-testid]="'capability-badge-' + badge.id"
                [title]="badge.detail"
              >
                {{ badge.label }}
                <span class="sr-only">: {{ badge.detail }}</span>
              </li>
            }
          </ul>
        }

        @if (notEnforced().length > 0) {
          <p data-testid="capability-not-enforced">
            Not enforced for {{ notEnforced().join(', ') }}
          </p>
        }

        @if (showPtahWarning()) {
          <p
            class="rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-warning"
            role="status"
            data-testid="capability-ptah-off-warning"
          >
            {{ ptahOffWarning }}
          </p>
        }
      </div>

      @if (error(); as message) {
        <p
          class="text-[11px] text-error"
          role="alert"
          data-testid="capability-toggle-error"
        >
          {{ message }}
        </p>
      }
    </div>
  `,
})
export class CapabilityToggleComponent {
  /** The row as the store holds it. */
  public readonly entry = input.required<CapabilityEntry>();

  /** Which layer this control writes to. */
  public readonly scope = input.required<CapabilityScope>();

  /** A write for this row is in flight; the control is disabled meanwhile. */
  public readonly pending = input(false);

  /** The row's last failed write, naming the item. */
  public readonly error = input<string | null>(null);

  /** The value the user asked for. */
  public readonly toggled = output<boolean>();

  protected readonly descriptionId = `ptah-capability-toggle-${nextToggleId++}`;
  protected readonly nextSessionNote = NEXT_SESSION_NOTE;
  protected readonly ptahOffWarning = PTAH_OFF_WARNING;

  /** The value this control's scope gives the item, and how to say it. */
  private readonly state = computed(() =>
    capabilityControlState(this.entry(), this.scope()),
  );

  protected readonly checked = computed(() => this.state().value ?? false);

  protected readonly indeterminate = computed(
    () => this.state().value === null,
  );

  protected readonly scopeText = computed(
    () => CAPABILITY_SCOPE_TEXT[this.scope()],
  );

  protected readonly badges = computed(() =>
    capabilityBadges(this.entry(), this.scope()),
  );

  protected readonly notEnforced = computed(() =>
    notEnforcedProviders(this.entry()),
  );

  /** AC-1.5: the item name, its on/off state and the scope it writes to. */
  protected readonly accessibleName = computed(
    () => `${this.entry().label}: ${this.state().text} (${this.scopeText()})`,
  );

  /**
   * AC-4.6: Ptah's own server is off in this workspace, or this control turns
   * it off (a global control switches it off for every workspace).
   */
  protected readonly showPtahWarning = computed(() => {
    const entry = this.entry();
    return (
      entry.kind === 'mcp' &&
      entry.id === PTAH_MCP_SERVER_NAME &&
      (entry.effectiveEnabled === false || this.state().value === false)
    );
  });

  protected badgeClass(badge: CapabilityBadge): string {
    return BADGE_TONE_CLASSES[badge.tone];
  }

  protected onChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const desired = input.checked;
    // The row, not the DOM, is the source of truth: put the box back until
    // the store answers with the new row.
    input.checked = this.checked();
    input.indeterminate = this.indeterminate();
    this.toggled.emit(desired);
  }
}

/** What each default reason means for the value, from `defaultEnabled`. */
const DEFAULT_REASON_ENABLED: Readonly<
  Record<CapabilityDefaultReason, boolean>
> = {
  ptah: true,
  'user-scope': true,
  skill: true,
  'plugin-opt-out': true,
  'repository-only': false,
  undeclared: false,
  'plugin-opt-in': false,
};

/** The value one control shows, `null` when it cannot be known. */
export interface CapabilityControlState {
  readonly value: boolean | null;
  /** The state words of the accessible name. */
  readonly text: string;
}

const UNKNOWN_STATE: CapabilityControlState = {
  value: null,
  text: 'state unknown',
};

/**
 * The value a control in `scope` shows.
 *
 * - `workspace`: the effective value in this workspace. While the policy is
 *   unreadable, the value this workspace records, or unknown.
 * - `global`: the value every workspace inherits — the recorded global value,
 *   else the default. A workspace override does not change it. While the
 *   policy is unreadable only a recorded global value is known.
 */
export function capabilityControlState(
  entry: CapabilityEntry,
  scope: CapabilityScope,
): CapabilityControlState {
  if (scope === 'workspace') {
    if (entry.effectiveEnabled !== null) {
      return known(entry.effectiveEnabled);
    }
    if (entry.workspaceEnabled === undefined) return UNKNOWN_STATE;
    return {
      value: entry.workspaceEnabled,
      text: `set ${onOff(entry.workspaceEnabled)}, effective state unknown`,
    };
  }
  if (entry.globalEnabled !== undefined) return known(entry.globalEnabled);
  if (entry.effectiveEnabled === null) return UNKNOWN_STATE;
  // Nothing recorded globally: every workspace inherits the default.
  if (entry.inheritedFrom === 'default') return known(entry.effectiveEnabled);
  return entry.defaultReason === undefined
    ? UNKNOWN_STATE
    : known(DEFAULT_REASON_ENABLED[entry.defaultReason]);
}

function known(value: boolean): CapabilityControlState {
  return { value, text: onOff(value) };
}

function onOff(value: boolean): string {
  return value ? 'on' : 'off';
}

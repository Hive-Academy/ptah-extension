import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
} from '@angular/core';
import type { CapabilityScope } from '@ptah-extension/shared';

/**
 * The user's install-scope choice. `null` means nothing is selected, which is
 * the state with no folder open until the user explicitly picks All
 * workspaces (design-spec §2, AC4).
 */
export type InstallScopeChoice = CapabilityScope | null;

/** What the install adds; it picks the noun and the workspace help line. */
export type InstallScopeItemKind = 'skill' | 'server';

/** Help line shown with no folder open (design-spec §2, AC4). */
export const INSTALL_SCOPE_NO_FOLDER_HELP =
  'Open a folder to install into a workspace, or choose All workspaces to install for every workspace.';

/**
 * The choice an install surface starts with: This workspace when a folder is
 * open, nothing otherwise. All workspaces is never a default.
 */
export function defaultInstallScope(workspaceOpen: boolean): InstallScopeChoice {
  return workspaceOpen ? 'workspace' : null;
}

/**
 * The choice that may actually be sent. A remembered `'workspace'` with no
 * folder open (the folder closed while the panel was up) counts as no
 * choice, so the caller keeps its primary button disabled.
 */
export function effectiveInstallScope(
  choice: InstallScopeChoice,
  workspaceOpen: boolean,
): InstallScopeChoice {
  if (choice === 'workspace' && !workspaceOpen) return null;
  return choice;
}

/** Primary button text for a skills install (design-spec §2). */
export function installScopeButtonLabel(scope: CapabilityScope): string {
  return scope === 'global'
    ? 'Install to all workspaces'
    : 'Install to this workspace';
}

interface ScopeOption {
  readonly value: CapabilityScope;
  readonly label: string;
}

const OPTIONS: readonly ScopeOption[] = [
  { value: 'workspace', label: 'This workspace' },
  { value: 'global', label: 'All workspaces' },
];

/** Gives each field instance its own radio group name and help id. */
let nextFieldId = 0;

/**
 * InstallScopeFieldComponent — the shared "This workspace / All workspaces"
 * choice of every install surface (design-spec §2 "Shared control").
 *
 * A native `fieldset`/`legend` names the group (no `role="radiogroup"`), so
 * native radios give arrow-key movement inside the group and Tab out of it.
 * The help line is the fieldset's description. With no folder open
 * (`workspaceName` is `null`) This workspace is disabled and nothing is
 * checked until the user picks All workspaces; the caller keeps its primary
 * button disabled while {@link effectiveInstallScope} is `null`.
 *
 * Presentational: the caller owns the choice through `[(scope)]` and picks
 * the default with {@link defaultInstallScope}.
 */
@Component({
  selector: 'ptah-install-scope-field',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset
      class="min-w-0"
      [attr.aria-describedby]="helpId"
      [disabled]="disabled()"
      data-testid="install-scope-field"
    >
      <legend
        class="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-base-content-muted"
      >
        {{ legend() }}
      </legend>
      <div class="join">
        @for (option of options; track option.value) {
          <label
            class="btn btn-sm join-item gap-1.5 font-normal has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary"
            [class.btn-primary]="current() === option.value"
            [class.btn-disabled]="optionDisabled(option.value)"
          >
            <input
              type="radio"
              class="radio radio-xs radio-primary"
              [name]="groupName"
              [value]="option.value"
              [checked]="current() === option.value"
              [disabled]="optionDisabled(option.value)"
              (change)="choose(option.value)"
            />
            {{ option.label }}
          </label>
        }
      </div>
      <p
        class="mt-1.5 text-xs text-base-content-muted"
        [id]="helpId"
        [attr.role]="showsNoFolderHelp() ? 'status' : null"
        data-testid="install-scope-help"
      >
        {{ help() }}
      </p>
    </fieldset>
  `,
})
export class InstallScopeFieldComponent {
  /** "Install to", "Install for" or "Install servers for". */
  public readonly legend = input.required<string>();
  public readonly itemKind = input.required<InstallScopeItemKind>();
  /** The open folder's display name, or `null` when no folder is open. */
  public readonly workspaceName = input<string | null>(null);
  /** Disables both options, for example while the install runs. */
  public readonly disabled = input(false);
  /**
   * Replaces the no-folder help line, for a surface whose primary action
   * stays enabled without a folder (the external-plugin consent dialog).
   */
  public readonly noFolderHelp = input<string | null>(null);
  /** The caller's choice; two-way bound. */
  public readonly scope = model<InstallScopeChoice>(null);

  private readonly fieldId = nextFieldId++;
  protected readonly groupName = `ptah-install-scope-${this.fieldId}`;
  protected readonly helpId = `ptah-install-scope-help-${this.fieldId}`;
  protected readonly options = OPTIONS;

  private readonly workspaceOpen = computed(
    () => this.workspaceName() !== null,
  );

  /** What is drawn as checked: never This workspace with no folder open. */
  protected readonly current = computed(() =>
    effectiveInstallScope(this.scope(), this.workspaceOpen()),
  );

  protected readonly showsNoFolderHelp = computed(
    () => !this.workspaceOpen() && this.current() !== 'global',
  );

  protected readonly help = computed(() => {
    if (this.showsNoFolderHelp()) {
      return this.noFolderHelp() ?? INSTALL_SCOPE_NO_FOLDER_HELP;
    }
    const kind = this.itemKind();
    if (this.current() === 'global') {
      return `Every workspace will get this ${kind}.`;
    }
    if (kind === 'server') {
      return 'This workspace writes only project files. Tools that keep settings in your home folder need All workspaces.';
    }
    const name = this.workspaceName() || 'this workspace';
    return `Only ${name} will get this skill. You can make it global later.`;
  });

  protected optionDisabled(value: CapabilityScope): boolean {
    return value === 'workspace' && !this.workspaceOpen();
  }

  protected choose(value: CapabilityScope): void {
    if (this.disabled() || this.optionDisabled(value)) return;
    this.scope.set(value);
  }
}

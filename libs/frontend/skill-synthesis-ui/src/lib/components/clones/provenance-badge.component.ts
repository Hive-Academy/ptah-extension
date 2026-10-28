/**
 * ProvenanceBadgeComponent (C7) — where one Library item came from.
 *
 * Pure presentational atom. The label comes only from `provenanceLabel`
 * (`@ptah-extension/shared`), the one label function the Library, the
 * Marketplace and the wizard completion share, so the three surfaces cannot
 * word the same origin differently. It is derived from the recorded origin
 * marker only, never from names or paths; an absent provenance (older host,
 * resolver failure) reads as "Workspace file".
 *
 * A plugin copy whose plugin is turned off or uninstalled keeps its origin
 * label ("Plugin: <former name>") and gains a separate status word
 * ("Plugin turned off" / "Orphaned"), so the state is never colour-only.
 *
 * The host is `display: contents`, so both badges sit directly in the parent
 * meta row (design-spec 3.6: first in the row, before the status badges).
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  provenanceLabel,
  type LibraryPluginState,
  type LibraryProvenance,
} from '@ptah-extension/shared';

interface PluginStateWord {
  readonly label: string;
  readonly toneClass: string;
}

const PLUGIN_BORDER = 'border-primary';
const DEFAULT_BORDER = 'border-[color:var(--surface-border-strong)]';

const PLUGIN_STATE_WORD: Record<LibraryPluginState, PluginStateWord | null> = {
  active: null,
  'turned-off': { label: 'Plugin turned off', toneClass: 'badge-ghost' },
  uninstalled: { label: 'Orphaned', toneClass: 'badge-warning' },
};

@Component({
  selector: 'ptah-provenance-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <span
      class="badge badge-sm border bg-base-300 text-base-content"
      [class]="borderClass()"
      [attr.title]="'Origin: ' + label()"
      data-testid="provenance-badge"
      >{{ label() }}</span
    >
    @if (stateWord(); as word) {
      <span
        class="badge badge-sm"
        [class]="word.toneClass"
        data-testid="provenance-plugin-state"
        >{{ word.label }}</span
      >
    }
  `,
})
export class ProvenanceBadgeComponent {
  /** Recorded origin; `null` / `undefined` render "Workspace file". */
  public readonly provenance = input<LibraryProvenance | null | undefined>(
    null,
  );

  protected readonly label = computed(() =>
    provenanceLabel(this.provenance()),
  );

  /** Plugin badges carry a primary border; every other origin the strong surface border. */
  protected readonly borderClass = computed(() =>
    this.provenance()?.kind === 'plugin'
      ? PLUGIN_BORDER
      : DEFAULT_BORDER,
  );

  protected readonly stateWord = computed<PluginStateWord | null>(() => {
    const p = this.provenance();
    return p?.kind === 'plugin' ? PLUGIN_STATE_WORD[p.state] : null;
  });
}

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChildren,
} from '@angular/core';

export type CommandRailTab = 'live' | 'work' | 'stats' | 'display';

interface RailTabModel {
  readonly key: CommandRailTab;
  readonly label: string;
}

export const COMMAND_RAIL_TABS: readonly RailTabModel[] = [
  { key: 'live', label: 'Live' },
  { key: 'work', label: 'Work' },
  { key: 'stats', label: 'Stats' },
  { key: 'display', label: 'Display' },
];

export function railTabId(key: CommandRailTab): string {
  return `command-rail-tab-${key}`;
}

export function railPanelId(key: CommandRailTab): string {
  return `command-rail-panel-${key}`;
}

/**
 * WAI-ARIA tablist for the Command Center rail: roving tabindex, arrow keys
 * move and activate, Home/End jump. The selected tab takes the shared
 * `.glass-glow` and `[data-glass-focus]` rules from the webview glass layer.
 */
@Component({
  selector: 'ptah-command-rail-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  styles: `
    [role='tab'] { min-height: 32px; }
    [role='tab'][aria-selected='true'] { border-color: oklch(var(--s)); }
    @media (forced-colors: none) and (prefers-contrast: no-preference) and (prefers-reduced-transparency: no-preference) {
      :host-context([data-theme][data-glass='on']) [role='tab'][aria-selected='true'] {
        background: var(--glass-sel);
      }
      :host-context([data-theme][data-glass='on']) .tab-badge {
        background: oklch(var(--bc) / var(--glass-badge-tint, 0.14));
        border-color: transparent;
      }
    }
  `,
  template: `
    <div
      role="tablist"
      aria-label="Selected agent views"
      class="flex min-w-0 items-center gap-1"
    >
      @for (tab of tabs; track tab.key) {
        <button
          #tabButton
          type="button"
          role="tab"
          data-glass-focus
          class="inline-flex flex-1 items-center justify-center gap-1 rounded-full border border-transparent px-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          [id]="tabId(tab.key)"
          [attr.aria-selected]="active() === tab.key"
          [class.glass-glow]="active() === tab.key"
          [attr.aria-controls]="controlsPanel(tab.key) ? panelId(tab.key) : null"
          [attr.tabindex]="active() === tab.key ? 0 : -1"
          [class.text-base-content]="active() === tab.key"
          [class.text-base-content-muted]="active() !== tab.key"
          [attr.data-testid]="'rail-tab-' + tab.key"
          (click)="activeChange.emit(tab.key)"
          (keydown)="onKeydown($event, tab.key)"
        >
          {{ tab.label }}
          @if (tab.key === 'display' && displayCount() > 0) {
            <span
              class="tab-badge badge badge-sm"
              [attr.aria-label]="displayCount() + ' items'"
              >{{ displayCount() }}</span
            >
          }
        </button>
      }
    </div>
  `,
})
export class CommandRailTabsComponent {
  public readonly active = input<CommandRailTab>('live');
  public readonly displayCount = input(0);
  public readonly activeChange = output<CommandRailTab>();

  protected readonly tabs = COMMAND_RAIL_TABS;
  protected readonly tabId = railTabId;
  protected readonly panelId = railPanelId;

  /**
   * Only reference panels that are in the DOM: the Live panel stays mounted
   * (hidden) to keep its transcript; the others render only while active.
   */
  protected controlsPanel(key: CommandRailTab): boolean {
    return key === 'live' || key === this.active();
  }
  private readonly buttons =
    viewChildren<ElementRef<HTMLButtonElement>>('tabButton');

  protected onKeydown(event: KeyboardEvent, current: CommandRailTab): void {
    const index = this.tabs.findIndex((tab) => tab.key === current);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % this.tabs.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index - 1 + this.tabs.length) % this.tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = this.tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.activeChange.emit(this.tabs[next].key);
    this.buttons()[next]?.nativeElement.focus();
  }
}

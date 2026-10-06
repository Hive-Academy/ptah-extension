import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import {
  AppStateManager,
  type ConfigurationSurfaceId,
} from '@ptah-extension/core';
import {
  LucideAngularModule,
  type LucideIconData,
  RadioTower,
  Settings,
  Store,
  Wrench,
} from 'lucide-angular';

/**
 * Global configuration actions for the Electron navbar: Thoth, Marketplace
 * and Settings as icon buttons, next to the theme toggle. With a workspace,
 * Setup hub is a navbar tab (see `ElectronShellComponent`); on the welcome
 * screen it is an icon button here (`showSetupHub`).
 *
 * The `config-menu-item-<id>` hooks are kept from the former dropdown menu:
 * the Electron e2e specs and the showcase harness address surfaces by them.
 */
@Component({
  selector: 'ptah-global-config-actions',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (item of items(); track item.id) {
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        [attr.data-test]="'config-menu-item-' + item.id"
        [attr.aria-label]="item.label"
        [title]="item.title ?? item.label"
        [attr.aria-current]="
          openConfigurationSurface() === item.id ? 'true' : null
        "
        [class.text-primary]="openConfigurationSurface() === item.id"
        [class.bg-base-300]="openConfigurationSurface() === item.id"
        (click)="selectItem(item.id)"
      >
        <lucide-angular [img]="item.icon" class="w-4 h-4" aria-hidden="true" />
      </button>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
  `,
})
export class GlobalConfigActionsComponent {
  private readonly appState = inject(AppStateManager);

  protected readonly openConfigurationSurface =
    this.appState.openConfigurationSurface;
  /**
   * Also render Setup hub as an icon button. The shell sets this on the
   * welcome screen, where the navbar tab strip (and its Setup hub tab) is
   * not rendered.
   */
  readonly showSetupHub = input(false);

  private readonly allItems: readonly {
    id: ConfigurationSurfaceId;
    label: string;
    title?: string;
    icon: LucideIconData;
  }[] = [
    {
      id: 'thoth',
      label: 'Thoth',
      title: 'Thoth — agentic platform',
      icon: RadioTower,
    },
    { id: 'setup-hub', label: 'Setup hub', icon: Wrench },
    { id: 'marketplace', label: 'Marketplace', icon: Store },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];
  protected readonly items = computed(() =>
    this.showSetupHub()
      ? this.allItems
      : this.allItems.filter((item) => item.id !== 'setup-hub'),
  );

  protected selectItem(id: ConfigurationSurfaceId): void {
    if (id === 'thoth' && !this.appState.thothFirstRunDismissed()) {
      this.appState.dismissThothFirstRun();
    }
    this.appState.setCurrentView(id);
  }
}

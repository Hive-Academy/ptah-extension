import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  AppStateManager,
  type ConfigurationSurfaceId,
} from '@ptah-extension/core';
import { NativeDropdownComponent } from '@ptah-extension/ui';
import {
  LucideAngularModule,
  type LucideIconData,
  RadioTower,
  Settings,
  SlidersHorizontal,
  Store,
  Wrench,
} from 'lucide-angular';

@Component({
  selector: 'ptah-global-config-menu',
  standalone: true,
  imports: [NativeDropdownComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-dropdown
      [isOpen]="isOpen()"
      placement="bottom-end"
      [closeOnBackdropClick]="true"
      [panelRole]="null"
      (closed)="closeMenu(menuTrigger)"
      (opened)="focusFirstItem(menuPanel)"
    >
      <button
        #menuTrigger
        trigger
        type="button"
        class="btn btn-ghost btn-sm btn-square focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        data-test="config-menu-trigger"
        aria-label="Configuration"
        title="Configuration"
        [attr.aria-expanded]="isOpen()"
        [class.text-primary]="openConfigurationSurface() !== null"
        [class.bg-base-300]="openConfigurationSurface() !== null"
        (click)="toggleMenu()"
      >
        <lucide-angular
          [img]="SlidersHorizontalIcon"
          class="w-4 h-4"
          aria-hidden="true"
        />
      </button>
      <div
        #menuPanel
        content
        class="flex min-w-44 flex-col py-1"
        (keydown.escape)="closeMenu(menuTrigger)"
        (keydown.arrowdown)="moveFocus($event, menuPanel, 1)"
        (keydown.arrowup)="moveFocus($event, menuPanel, -1)"
      >
        @for (item of items; track item.id) {
          <button
            type="button"
            class="flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-base-300 focus-visible:outline-none focus-visible:bg-base-300 focus-visible:ring-1 focus-visible:ring-primary"
            [attr.data-test]="'config-menu-item-' + item.id"
            [title]="item.title ?? item.label"
            [attr.aria-current]="
              openConfigurationSurface() === item.id ? 'true' : null
            "
            [class.text-primary]="openConfigurationSurface() === item.id"
            [class.bg-base-300]="openConfigurationSurface() === item.id"
            (click)="selectItem(item.id, menuTrigger)"
          >
            <lucide-angular
              [img]="item.icon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            <span>{{ item.label }}</span>
          </button>
        }
      </div>
    </ptah-native-dropdown>
  `,
})
export class GlobalConfigMenuComponent {
  private readonly appState = inject(AppStateManager);

  protected readonly isOpen = signal(false);
  protected readonly openConfigurationSurface =
    this.appState.openConfigurationSurface;
  protected readonly SlidersHorizontalIcon = SlidersHorizontal;
  protected readonly items: readonly {
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

  protected toggleMenu(): void {
    this.isOpen.update((isOpen) => !isOpen);
  }

  protected closeMenu(trigger: HTMLButtonElement): void {
    this.isOpen.set(false);
    trigger.focus();
  }

  protected focusFirstItem(panel: HTMLElement): void {
    if (this.isOpen()) {
      panel.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }

  protected moveFocus(
    event: Event,
    panel: HTMLElement,
    direction: 1 | -1,
  ): void {
    event.preventDefault();
    const buttons = Array.from(
      panel.querySelectorAll<HTMLButtonElement>('button'),
    );
    if (buttons.length === 0) return;

    const currentIndex = buttons.indexOf(
      panel.ownerDocument.activeElement as HTMLButtonElement,
    );
    let nextIndex: number;
    if (currentIndex === -1) {
      nextIndex = direction === 1 ? 0 : buttons.length - 1;
    } else {
      nextIndex = (currentIndex + direction + buttons.length) % buttons.length;
    }
    buttons[nextIndex]?.focus();
  }

  protected selectItem(
    id: ConfigurationSurfaceId,
    trigger: HTMLButtonElement,
  ): void {
    this.closeMenu(trigger);
    if (id === 'thoth' && !this.appState.thothFirstRunDismissed()) {
      this.appState.dismissThothFirstRun();
    }
    this.appState.setCurrentView(id);
  }
}

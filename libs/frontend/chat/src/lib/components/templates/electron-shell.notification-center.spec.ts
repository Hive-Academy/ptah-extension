import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '{{ data() }}',
  })
  class MarkdownStubComponent {
    readonly data = input<string | null | undefined>('');
  }

  return {
    MarkdownModule: MarkdownStubComponent,
    MarkdownComponent: MarkdownStubComponent,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});

import {
  AppStateManager, ElectronLayoutService, SurfaceRouterService, VSCodeService,
} from '@ptah-extension/core';
import { NotificationCenterComponent, NotificationSoundService } from '@ptah-extension/notification-center';
import { ChatFailedTurnAttentionService } from '../../services/chat-failed-turn-attention.service';
import { ClosedTabSessionEnderService } from '../../services/closed-tab-session-ender.service';
import { ElectronShellComponent } from './electron-shell.component';

describe('ElectronShell notification center composition', () => {
  it('places exactly one bell in the Electron global action row', () => {
    const source = readFileSync(
      resolve(
        __dirname,
        'electron-shell.component.ts',
      ),
      'utf8',
    );
    expect(source.match(/<ptah-notification-center\s+#notificationCenter\s*\/>/g)).toHaveLength(1);
    expect(source.match(/<ptah-notification-snackbar\b/g)).toHaveLength(1);
    expect(source).toContain('[panelOpen]="notificationPanelOpen()"');
    expect(source).toContain('(openNotifications)="openNotifications()"');
    expect(source).toContain('NotificationSnackbarComponent');
    expect(source).toContain('provide: NOTIFICATION_FOCUS_ROUTER');
    expect(source).toContain('useExisting: NotificationFocusCoordinator');
  });

  it('opens the bell once after an early open request mounts it', async () => {
    const currentView = signal('settings');
    const setCurrentView = jest.fn((view: string) => currentView.set(view));
    const openPanel = jest.spyOn(NotificationCenterComponent.prototype, 'openPanel');
    try {
      await TestBed.configureTestingModule({
        imports: [ElectronShellComponent],
        providers: [
          { provide: ClosedTabSessionEnderService, useValue: {} },
          { provide: ChatFailedTurnAttentionService, useValue: {} },
          { provide: NotificationSoundService, useValue: {} },
          { provide: ElectronLayoutService, useValue: { editorPanelVisible: () => false } },
          { provide: AppStateManager, useValue: {
            currentView,
            openConfigurationSurface: signal<string | null>(null),
            configurationSurfaceRemountTick: signal(0),
            setLayoutMode: jest.fn(),
            setCurrentView,
          } },
          { provide: SurfaceRouterService, useValue: {
            pendingSurface: () => null,
            remountActiveSurface: jest.fn(),
          } },
          { provide: VSCodeService, useValue: {
            getPtahIconUri: () => 'icon.png',
            config: () => ({ platform: 'win32' }),
          } },
        ],
      })
        .overrideComponent(ElectronShellComponent, {
          set: {
            imports: [NotificationCenterComponent],
            providers: [],
            template: `
              <button type="button" (click)="openNotifications()">Open notifications</button>
              @if (appState.currentView() === 'chat') {
                <ptah-notification-center />
              }
            `,
          },
        })
        .overrideComponent(NotificationCenterComponent, {
          set: { imports: [], template: '' },
        })
        .compileComponents();

      const fixture = TestBed.createComponent(ElectronShellComponent);
      try {
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('ptah-notification-center')).toBeNull();
        (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
        expect(setCurrentView).toHaveBeenCalledWith('chat');
        expect(openPanel).not.toHaveBeenCalled();
        fixture.detectChanges();
        await fixture.whenStable();
        expect(fixture.nativeElement.querySelector('ptah-notification-center')).not.toBeNull();
        expect(openPanel).toHaveBeenCalledTimes(1);
        fixture.detectChanges();
        expect(openPanel).toHaveBeenCalledTimes(1);
      } finally {
        fixture.destroy();
      }
    } finally {
      TestBed.resetTestingModule();
      openPanel.mockRestore();
    }
  });
});

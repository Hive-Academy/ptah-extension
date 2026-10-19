import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ElectronShell notification center composition', () => {
  it('places exactly one bell in the Electron global action row', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts',
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

  it('opens the typed bell and starts failure and sound projection from the shell', () => {
    const source = readFileSync(resolve(process.cwd(), 'libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts'), 'utf8');
    expect(source).toContain('viewChild(NotificationCenterComponent)');
    expect(source).toContain('this.pendingNotificationOpen.set(true)');
    expect(source).toContain("this.appState.setCurrentView('chat')");
    expect(source).toContain('if (this.pendingNotificationOpen())');
    expect(source).toContain('bell.openPanel()');
    expect(source).toContain('inject(ChatFailedTurnAttentionService)');
    expect(source).toContain('inject(NotificationSoundService)');
    expect(source).not.toContain("querySelector<HTMLButtonElement>('[data-testid=\"notification-center-bell\"]')");
  });
});

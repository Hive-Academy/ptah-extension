import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('AppShell notification center composition', () => {
  it('places exactly one bell in the non-Electron header action branch', () => {
    const html = readFileSync(
      resolve(
        process.cwd(),
        'libs/frontend/chat/src/lib/components/templates/app-shell.component.html',
      ),
      'utf8',
    );
    expect(html.match(/<ptah-notification-center\s+#notificationCenter\s*\/>/g)).toHaveLength(1);
    const nonElectronActions = html.slice(
      html.indexOf('<!-- App-level actions'),
    );
    expect(nonElectronActions).toContain('@if (!isElectron)');
    expect(nonElectronActions).toContain('<ptah-notification-center #notificationCenter />');
    expect(html.match(/<ptah-notification-snackbar\b/g)).toHaveLength(1);
    expect(html).toContain('[panelOpen]="notificationPanelOpen()"');
    expect(html).toContain('(openNotifications)="openNotifications()"');
  });

  it('provides the core focus-router token through the coordinator', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'libs/frontend/chat/src/lib/components/templates/app-shell.component.ts',
      ),
      'utf8',
    );
    expect(source).toContain('provide: NOTIFICATION_FOCUS_ROUTER');
    expect(source).toContain('useExisting: NotificationFocusCoordinator');
  });

  it('opens the typed bell and starts failure and sound projection from the shell', () => {
    const source = readFileSync(resolve(process.cwd(), 'libs/frontend/chat/src/lib/components/templates/app-shell.component.ts'), 'utf8');
    expect(source).toContain('viewChild(NotificationCenterComponent)');
    expect(source).toContain('bell.openPanel()');
    expect(source).toContain('inject(ChatFailedTurnAttentionService)');
    expect(source).toContain('inject(NotificationSoundService)');
    expect(source).not.toContain("querySelector<HTMLButtonElement>('[data-testid=\"notification-center-bell\"]')");
  });
});

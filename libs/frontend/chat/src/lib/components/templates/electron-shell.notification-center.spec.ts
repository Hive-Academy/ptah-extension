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
    expect(source.match(/<ptah-notification-center\s*\/>/g)).toHaveLength(1);
    expect(source).toContain('provide: NOTIFICATION_FOCUS_ROUTER');
    expect(source).toContain('useExisting: NotificationFocusCoordinator');
  });
});

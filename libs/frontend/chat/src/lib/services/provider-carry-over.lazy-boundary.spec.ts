import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  sourceFiles,
  specifiersOf,
  withoutComments,
} from '../components/testing/lazy-boundary.helpers';

/**
 * The carry-over launch path and the auth-required banner load on demand,
 * which keeps the webview's initial bundle under its budget (TASK_2026_865).
 * A static import of either from eager code would pull it back in silently.
 */
const CHAT_SRC = join(__dirname, '..', '..');
const files = sourceFiles(CHAT_SRC).map((path) => ({
  name: basename(path, '.ts'),
  source: readFileSync(path, 'utf8'),
}));

function importersOf(module: string): string[] {
  return files
    .filter((file) =>
      specifiersOf(file.source).some((specifier) =>
        specifier.endsWith('/' + module),
      ),
    )
    .map((file) => file.name);
}

describe('carry-over lazy boundaries', () => {
  it('loads the launch path only through a dynamic import', () => {
    expect(importersOf('provider-carry-over-launch')).toEqual([]);
    const service = withoutComments(
      readFileSync(join(__dirname, 'provider-carry-over.service.ts'), 'utf8'),
    );
    expect(service).toContain("import('./provider-carry-over-launch')");
  });

  it('renders the auth-required banner only inside a deferred block', () => {
    expect(importersOf('auth-required-banner.component')).toEqual([
      'chat-view.component',
    ]);
    const templates = join(__dirname, '..', 'components', 'templates');
    const view = withoutComments(
      readFileSync(join(templates, 'chat-view.component.html'), 'utf8'),
    );
    expect(view).toMatch(
      /@defer\s*\(on immediate\)\s*\{\s*<ptah-auth-required-banner/,
    );
    expect(view.match(/<ptah-auth-required-banner/g)).toHaveLength(1);
    // Only the import and the `imports` entry: any other use makes it eager.
    const controller = withoutComments(
      readFileSync(join(templates, 'chat-view.component.ts'), 'utf8'),
    );
    expect(controller.match(/\bAuthRequiredBannerComponent\b/g)).toHaveLength(
      2,
    );
  });
});

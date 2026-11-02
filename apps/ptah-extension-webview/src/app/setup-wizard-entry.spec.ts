/** Pins the eager setup-wizard services entry used at webview bootstrap. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP_ENTRY = join(
  __dirname,
  '../../../../libs/frontend/setup-wizard/src/app.ts',
);

/** Files the narrow entry may re-export; none of them sits inside `@defer`. */
const ALLOWED_EXPORT_SOURCES = [
  './lib/services/setup-wizard-state.service',
  './lib/services/setup-generation-open.handler',
  './lib/services/generation-run-event-adapter',
  './lib/services/wizard-internal-state.provider',
];

/** Module specifiers of real import/export declarations (comments stripped). */
function specifiers(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

describe('setup-wizard eager entry', () => {
  it.each(['app.config.ts', 'app.routes.ts'])(
    '%s uses only the narrow /app entry for setup wizard imports',
    (file) => {
      const source = readFileSync(join(__dirname, file), 'utf8');
      const wizardImports = specifiers(source).filter((s) =>
        s.startsWith('@ptah-extension/setup-wizard'),
      );
      if (file === 'app.config.ts')
        expect(wizardImports.length).toBeGreaterThan(0);
      expect(wizardImports).toEqual(
        wizardImports.map(() => '@ptah-extension/setup-wizard/app'),
      );
    },
  );

  it('the /app entry re-exports no deferred component', () => {
    const exported = specifiers(readFileSync(APP_ENTRY, 'utf8'));
    expect(exported.length).toBeGreaterThan(0);
    for (const source of exported) {
      expect(ALLOWED_EXPORT_SOURCES).toContain(source);
    }
  });
});

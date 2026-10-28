/**
 * Pins the eager setup-wizard edge (TASK_2026_701).
 *
 * The composition root (`app.config.ts`, `app.routes.ts`) must reach the setup
 * wizard only through the narrow `@ptah-extension/setup-wizard/app` entry. The
 * wide barrel re-exports the step components that `WizardViewComponent` and
 * the generation sidebar render inside `@defer`. A static import of that barrel
 * from eager code puts them back into the initial bundle: the production
 * metafile measured about 208 kB, enough to break the 4 MB initial budget.
 * The Nx boundary rule treats `webview -> setup-wizard` as one allowed edge and
 * cannot tell the entry points apart, so this spec pins the source shape.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP_ENTRY = join(
  __dirname,
  '../../../../libs/frontend/setup-wizard/src/app.ts',
);

/** Files the narrow entry may re-export; none of them sits inside `@defer`. */
const ALLOWED_EXPORT_SOURCES = [
  './lib/components/wizard-view.component',
  './lib/components/generation-workflow-shell.component',
  './lib/services/setup-wizard-state.service',
  './lib/services/setup-generation-open.handler',
  './lib/services/generation-run-event-adapter',
  './lib/services/wizard-internal-state.provider',
  './lib/services/setup-wizard-focus-router.provider',
];

/** Module specifiers of real import/export declarations (comments stripped). */
function specifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

describe('setup-wizard eager entry', () => {
  it.each(['app.config.ts', 'app.routes.ts'])(
    '%s imports the setup wizard only through the narrow /app entry',
    (file) => {
      const source = readFileSync(join(__dirname, file), 'utf8');
      const wizardImports = specifiers(source).filter((s) =>
        s.startsWith('@ptah-extension/setup-wizard'),
      );
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

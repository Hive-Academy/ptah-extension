import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { App } from './app';

describe('App', () => {
  // The original scaffolded spec imported `./nx-welcome`, which was removed
  // once the webview started rendering real chat/electron shells. Until a
  // proper harness that mocks AppStateManager / VSCodeService /
  // WebviewNavigationService is in place, keep a smoke assertion that the
  // bootstrap component is still exported. The real integration coverage
  // lives in the @ptah-extension/chat and @ptah-extension/core specs.
  it('exports the root App component', () => {
    expect(App).toBeDefined();
    expect(App.name).toBe('App');
  });
});

/**
 * The three top-level states of `app.html` must be ONE exclusive chain.
 *
 * TASK_2026_380's logic review found F-2: as three independent sibling `@if`s,
 * a `boot:readinessChanged` push carrying `readiness: 'failed'` that lands
 * while `ngOnInit`'s `handleInitialView()` await is still pending makes
 * `isInitializing()` and `hasError()` true at the same instant, and the user
 * gets a spinner and an "Initialization Error" alert stacked in one `<main>`.
 *
 * No await ordering can fix that, because `hasError()` reads a signal the host
 * flips asynchronously — only mutual exclusion can. This is a source sweep for
 * the same reason `no-alpha-base-content.spec.ts` is one: the defect lives in
 * the template's STRUCTURE, and jsdom renders a stacked pair as happily as it
 * renders a correct one.
 */
describe('app.html top-level branch exclusivity (F-2)', () => {
  const template = readFileSync(join(__dirname, 'app.html'), 'utf-8');

  /** Index of each branch head, in the order they must appear. */
  const errorAt = template.indexOf('@if (hasError())');
  const loadingAt = template.indexOf('@else if (appState.isLoading()');
  const shellAt = template.indexOf('@else if (isReady())');

  it('opens the chain with the error branch', () => {
    expect(errorAt).toBeGreaterThanOrEqual(0);
  });

  it('continues with loading and shell as @else if, never as new @ifs', () => {
    expect(loadingAt).toBeGreaterThan(errorAt);
    expect(shellAt).toBeGreaterThan(loadingAt);
  });

  it('has exactly one top-level @if — a second one would break exclusivity', () => {
    // Every other `@if` in this template is nested inside a branch and is
    // indented; a top-level one starts at the beginning of a line.
    const topLevelIfs = template.match(/^\s{2}@if \(/gm) ?? [];
    expect(topLevelIfs).toHaveLength(1);
  });

  it('no longer needs the defensive !isLoading / !isBlockingBoot guards on the shell branch', () => {
    // Those guards existed only because the branches were independent. Leaving
    // them behind an @else if would be dead conditions that read as if the
    // overlap were still possible.
    expect(template).not.toContain('isReady() && !appState.isLoading()');
  });

  it('renders the boot screen only for the blocking phases', () => {
    expect(template).toContain('bootStatus.isBlockingBoot()');
    expect(template).toContain('<ptah-boot-progress');
  });
});

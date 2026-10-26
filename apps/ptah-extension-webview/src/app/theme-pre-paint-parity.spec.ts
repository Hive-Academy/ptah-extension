/**
 * Parity guard between the pre-paint theme script in `src/index.html` and
 * `ThemeService.initializeTheme()`.
 *
 * Both resolve the persisted theme on their own — the script before any
 * module is evaluated, the service once Angular boots — and the service's
 * DOM effect then repaints whatever the script chose. If the two disagree,
 * the user sees one frame of the wrong theme on every launch. The glass
 * migration (versioned `theme-v2` / `ptah-theme-v2` keys, legacy `theme` /
 * `ptah-theme` mapped onto the glass pair) added a tier to both, so this spec
 * runs the real script and the real service against the same persisted data
 * and compares the resulting `<html>` attributes and deferred-sheet insertion,
 * not just the service's signal.
 *
 * Each case runs in two shapes:
 *   - Electron: `getState()` is readable pre-paint, mirrors as persisted.
 *   - VS Code: the script cannot read state, so the case's state values are
 *     moved into their localStorage mirrors (what `setTheme` and the pre-glass
 *     build both wrote alongside state) and state is empty.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ThemeService, VSCodeService } from '@ptah-extension/core';

const INDEX_HTML = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

function prePaintSource(): string {
  const match = /<script>([\s\S]*?)<\/script>/.exec(INDEX_HTML);
  if (!match) {
    throw new Error(
      'index.html no longer carries the inline pre-paint script.',
    );
  }
  return match[1];
}

const PRE_PAINT = prePaintSource();

/** The attributes `<html>` carries in `index.html` before any script runs. */
const INITIAL_ATTRIBUTES: Readonly<Record<string, string>> = {
  'data-theme': 'ptah-glass',
  'data-theme-mode': 'dark',
  'data-glass': 'on',
  'data-glass-mode': 'dark',
};

const COMPARED = [...Object.keys(INITIAL_ATTRIBUTES), 'data-accent', 'data-scene'];

const STATE_TO_HINT: Readonly<Record<string, string>> = {
  'theme-v2': 'ptah-theme-v2',
  theme: 'ptah-theme',
};

interface Persisted {
  readonly state: Readonly<Record<string, string>>;
  readonly hints: Readonly<Record<string, string>>;
}

interface Painted {
  readonly attributes: Record<string, string | null>;
  readonly deferredSheet: boolean;
}

type VsCodeWindow = Window & {
  vscode?: { getState: () => Record<string, string> };
};

function resetDocument(hints: Readonly<Record<string, string>>): void {
  localStorage.clear();
  for (const [key, value] of Object.entries(hints)) {
    localStorage.setItem(key, value);
  }
  const root = document.documentElement;
  root.removeAttribute('data-accent');
  root.removeAttribute('data-scene');
  for (const [name, value] of Object.entries(INITIAL_ATTRIBUTES)) {
    root.setAttribute(name, value);
  }
  document.getElementById('ptah-theme-extra-sheet')?.remove();
  document.getElementById('ptah-theme-extra')?.remove();
  // The non-fetching marker index.html carries, so both sides can insert the
  // deferred sheet and that insertion can be compared too.
  const marker = document.createElement('link');
  marker.id = 'ptah-theme-extra';
  marker.rel = 'ptah-deferred-stylesheet';
  marker.href = 'theme-extra.css';
  document.head.appendChild(marker);
}

function snapshot(): Painted {
  const root = document.documentElement;
  return {
    attributes: Object.fromEntries(
      COMPARED.map((name) => [name, root.getAttribute(name)]),
    ),
    deferredSheet: document.getElementById('ptah-theme-extra-sheet') !== null,
  };
}

function runPrePaint(persisted: Persisted): Painted {
  resetDocument(persisted.hints);
  const win = window as VsCodeWindow;
  const hasState = Object.keys(persisted.state).length > 0;
  if (hasState) {
    win.vscode = { getState: () => ({ ...persisted.state }) };
  }
  try {
    // jsdom does not execute inline <script>; evaluating the extracted source
    // runs exactly the code the browser runs in <head>.
    new Function(PRE_PAINT)();
  } finally {
    delete win.vscode;
  }
  return snapshot();
}

function runService(persisted: Persisted): {
  painted: Painted;
  writes: Array<[string, unknown]>;
} {
  resetDocument(persisted.hints);
  const writes: Array<[string, unknown]> = [];
  TestBed.configureTestingModule({
    providers: [
      ThemeService,
      {
        provide: VSCodeService,
        useValue: {
          getState: (key: string) => persisted.state[key],
          setState: (key: string, value: unknown) => writes.push([key, value]),
          config: () => ({ theme: 'dark' }),
        },
      },
    ],
  });
  TestBed.inject(ThemeService);
  // Flush the service's DOM effect so its attributes are what is compared.
  TestBed.inject(ApplicationRef).tick();
  const painted = snapshot();
  TestBed.resetTestingModule();
  return { painted, writes };
}

/** VS Code shape: state values moved into their mirrors, state empty. */
function mirrorsOnly(persisted: Persisted): Persisted {
  const hints: Record<string, string> = {};
  for (const [key, value] of Object.entries(persisted.state)) {
    hints[STATE_TO_HINT[key] ?? key] = value;
  }
  return { state: {}, hints: { ...hints, ...persisted.hints } };
}

const CASES: ReadonlyArray<{
  readonly name: string;
  readonly persisted: Persisted;
  readonly expected: string;
}> = [
  {
    name: 'fresh install',
    persisted: { state: {}, hints: {} },
    expected: 'ptah-glass',
  },
  {
    name: 'legacy dark theme migrates to ptah-glass',
    persisted: { state: { theme: 'anubis' }, hints: {} },
    expected: 'ptah-glass',
  },
  {
    name: 'legacy light theme migrates to ptah-glass-light',
    persisted: { state: { theme: 'anubis-light' }, hints: {} },
    expected: 'ptah-glass-light',
  },
  {
    name: 'legacy deferred dark theme migrates without the deferred sheet',
    persisted: { state: { theme: 'dracula' }, hints: {} },
    expected: 'ptah-glass',
  },
  {
    name: 'legacy glass-light is kept',
    persisted: { state: { theme: 'ptah-glass-light' }, hints: {} },
    expected: 'ptah-glass-light',
  },
  {
    name: 'a v2 choice of anubis wins over the legacy value',
    persisted: {
      state: { 'theme-v2': 'anubis', theme: 'anubis-light' },
      hints: {},
    },
    expected: 'anubis',
  },
  {
    name: 'a v2 deferred theme applies with the deferred sheet',
    persisted: { state: { 'theme-v2': 'cupcake', theme: 'anubis' }, hints: {} },
    expected: 'cupcake',
  },
  {
    name: 'second Electron workspace: legacy state plus an origin-wide v2 mirror',
    persisted: {
      state: { theme: 'anubis' },
      hints: { 'ptah-theme-v2': 'nord' },
    },
    expected: 'nord',
  },
  {
    name: 'an unknown v2 value keeps the default instead of migrating',
    persisted: {
      state: { 'theme-v2': 'retired', theme: 'cupcake' },
      hints: {},
    },
    expected: 'ptah-glass',
  },
];

describe('pre-paint theme script and ThemeService agree', () => {
  afterEach(() => {
    localStorage.clear();
    document.getElementById('ptah-theme-extra-sheet')?.remove();
    document.getElementById('ptah-theme-extra')?.remove();
    for (const name of COMPARED) {
      document.documentElement.removeAttribute(name);
    }
  });

  const shapes: Array<[string, (persisted: Persisted) => Persisted]> = [
    ['Electron: state readable pre-paint', (persisted) => persisted],
    ['VS Code: localStorage mirrors only', mirrorsOnly],
  ];

  describe.each(shapes)('%s', (_shape, shape) => {
    it.each(CASES)('$name', ({ persisted, expected }) => {
      const input = shape(persisted);
      const prePaint = runPrePaint(input);
      const service = runService(input);

      expect(prePaint.attributes['data-theme']).toBe(expected);
      expect(service.painted).toEqual(prePaint);
      // Boot never writes state, on any path.
      expect(service.writes).toEqual([]);
    });
  });

  describe.each(shapes)('scene parity: %s', (_shape, shape) => {
    it.each([
      ['state choice', { 'ptah-scene': 'ember' }, {}, 'ember'],
      ['mirror only', {}, { 'ptah-scene': 'tide' }, 'tide'],
      ['invalid state uses mirror', { 'ptah-scene': 'retired' }, { 'ptah-scene': 'horizon' }, 'horizon'],
      ['joined ids are invalid', { 'ptah-scene': 'ember tide' }, { 'ptah-scene': 'horizon' }, 'horizon'],
      ['invalid values', { 'ptah-scene': 'retired' }, { 'ptah-scene': 'invalid' }, null],
      ['stored default', { 'ptah-scene': 'aurora' }, {}, null],
    ] as const)('%s', (_name, state, hints, expected) => {
      for (const theme of [undefined, 'ptah-glass', 'ptah-glass-light', 'dark', 'nord', 'cupcake', 'dracula', 'light']) {
        const persisted = shape({ state: { ...state, ...(theme ? { 'theme-v2': theme } : {}) }, hints });
        const before = runPrePaint(persisted);
        const after = runService(persisted);
        expect(before.attributes['data-scene']).toBe(!theme || theme === 'ptah-glass' || theme === 'ptah-glass-light' ? expected : null);
        expect(after.painted).toEqual(before);
        expect(after.writes).toEqual([]);
        expect(localStorage.getItem('ptah-scene')).toBe(persisted.hints['ptah-scene'] ?? null);
      }
    });
  });

  it('keeps valid state aurora ahead of a stale non-default mirror', () => {
    const persisted = { state: { 'ptah-scene': 'aurora' }, hints: { 'ptah-scene': 'ember' } };
    expect(runPrePaint(persisted).attributes['data-scene']).toBeNull();
    expect(runService(persisted).painted.attributes['data-scene']).toBeNull();
    expect(localStorage.getItem('ptah-scene')).toBe('ember');
  });

  it('writes nothing at boot on the migration path, so a later launch re-derives the same theme', () => {
    const persisted: Persisted = {
      state: { theme: 'nord' },
      hints: { 'ptah-theme': 'nord' },
    };
    const first = runService(persisted);
    expect(first.painted.attributes['data-theme']).toBe('ptah-glass-light');
    expect(first.writes).toEqual([]);
    expect(localStorage.getItem('ptah-theme-v2')).toBeNull();
    expect(runPrePaint(persisted).attributes['data-theme']).toBe(
      'ptah-glass-light',
    );
  });
});

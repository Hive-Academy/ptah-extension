/**
 * Guards for the sandboxed preload.
 *
 * The main window runs with `sandbox: true` (`windows/main-window.ts`). A
 * sandboxed preload can `require` only `electron`, `events`, `timers` and
 * `url`, and `build-preload` leaves every npm package external
 * (`thirdParty: false`), so any package import here ships as a runtime
 * `require("<pkg>")` that throws before `contextBridge` runs: a blank window
 * with no RPC bridge. Jest resolves packages normally and cannot see that
 * failure, so the import list is pinned from source.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const exposed = new Map<string, unknown>();
let startupReply: unknown = null;

jest.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: unknown) => {
      exposed.set(key, api);
    },
  },
  ipcRenderer: {
    sendSync: () => startupReply,
    send: jest.fn(),
    on: jest.fn(),
    invoke: jest.fn(),
  },
}));

const PRELOAD_PATH = join(__dirname, 'preload.ts');

function loadPreloadWith(reply: unknown): Record<string, unknown> {
  exposed.clear();
  startupReply = reply;
  jest.isolateModules(() => {
    require('./preload');
  });
  const config = exposed.get('ptahConfig');
  if (typeof config !== 'object' || config === null) {
    throw new Error('preload did not expose ptahConfig');
  }
  return Object.fromEntries(Object.entries(config));
}

describe('preload import surface', () => {
  const source = readFileSync(PRELOAD_PATH, 'utf8');

  it('imports nothing but electron', () => {
    const specifiers = [
      ...source.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm),
      ...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
      ...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((match) => match[1]);

    expect(specifiers.length).toBeGreaterThan(0);
    expect([...new Set(specifiers)]).toEqual(['electron']);
  });
});

describe('preload startup config narrowing', () => {
  it('passes a well-formed reply through', () => {
    const config = loadPreloadWith({
      initialView: 'settings',
      workspaceRoot: '/tmp/demo',
      workspaceName: 'demo',
      zoneChangeDetectionFallback: true,
      gpuCompositing: 'software',
    });

    expect(config).toMatchObject({
      initialView: 'settings',
      workspaceRoot: '/tmp/demo',
      workspaceName: 'demo',
      zoneChangeDetectionFallback: true,
      gpuCompositing: 'software',
    });
  });

  it('falls back to defaults when the reply is not an object', () => {
    const config = loadPreloadWith('not-a-config');

    expect(config).toMatchObject({
      initialView: 'chat',
      workspaceRoot: '',
      workspaceName: '',
      zoneChangeDetectionFallback: false,
      gpuCompositing: 'hardware',
    });
  });

  it('rejects the whole reply when any field has the wrong type', () => {
    const config = loadPreloadWith({
      workspaceRoot: '/tmp/demo',
      gpuCompositing: 'quantum',
    });

    expect(config['workspaceRoot']).toBe('');
    expect(config['gpuCompositing']).toBe('hardware');
  });

  it('accepts a null initialView and missing optional fields', () => {
    const config = loadPreloadWith({ initialView: null });

    expect(config['initialView']).toBe('chat');
    expect(config['gpuCompositing']).toBe('hardware');
  });
});

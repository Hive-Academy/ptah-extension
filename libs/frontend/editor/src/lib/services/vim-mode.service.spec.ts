/**
 * VimModeService — unit specs for the monaco-vim UMD load path.
 *
 * Coverage (TASK_2026_371 D2):
 *   - Monaco's AMD `define` is hidden at the moment the script is appended and
 *     restored afterwards, on `onload` AND on `onerror`.
 *   - A page with no AMD loader (no `define`, or a `define` without `.amd`)
 *     has its global left untouched.
 *   - A load that resolves without `window.MonacoVim` is terminal: no second
 *     script is ever injected (the loader's repeating
 *     "Can only have one anonymous define call per script file").
 *   - Happy path: `initVimMode` is called with the editor and status bar, and
 *     its disposable is disposed by `detach()`.
 *
 * jsdom never executes a script's `src`, so the script element is captured via
 * a `document.createElement` spy and its `onload` / `onerror` are fired by hand.
 *
 * Source-under-test:
 *   libs/frontend/editor/src/lib/services/vim-mode.service.ts
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { VimModeService } from './vim-mode.service';

// ---------------------------------------------------------------------------
// Mock rpcCall from @ptah-extension/core (loadPreference / toggle only)
// ---------------------------------------------------------------------------
const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return {
    ...actual,
    rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  };
});

// ---------------------------------------------------------------------------
// Minimal VSCodeService stub
// ---------------------------------------------------------------------------
function makeVscodeStub() {
  return {
    config: signal({
      isVSCode: false,
      theme: 'dark',
      workspaceRoot: '/test-workspace',
      workspaceName: 'test',
      extensionUri: '',
      baseUri: '',
      iconUri: '',
      userIconUri: '',
      panelId: '',
      isElectron: false,
    }).asReadonly(),
    isConnected: signal(false).asReadonly(),
    getState: jest.fn().mockReturnValue(null),
    setState: jest.fn(),
    postMessage: jest.fn(),
    messages$: { pipe: jest.fn() },
    handleMessage: jest.fn(),
    handledMessageTypes: [],
  };
}

/** An AMD `define` shaped like the one Monaco's loader installs. */
function makeAmdDefine(): Window['define'] {
  const amdDefine = jest.fn() as unknown as NonNullable<Window['define']>;
  amdDefine.amd = {};
  return amdDefine;
}

/** Let every pending microtask (and the service's `.then`) run. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('VimModeService — monaco-vim UMD load', () => {
  let service: VimModeService;
  let createdScripts: HTMLScriptElement[];
  let appendedScripts: HTMLScriptElement[];
  /** `window.define` sampled at each `appendChild`, in append order. */
  let defineAtAppend: unknown[];
  const originalCreateElement = document.createElement.bind(document);
  const originalDefine = window.define;

  beforeEach(async () => {
    createdScripts = [];
    appendedScripts = [];
    defineAtAppend = [];
    mockRpcCall.mockReset();

    jest
      .spyOn(document, 'createElement')
      .mockImplementation(
        (tagName: string, options?: ElementCreationOptions) => {
          const element = originalCreateElement(tagName, options);
          if (element instanceof HTMLScriptElement) {
            createdScripts.push(element);
          }
          return element;
        },
      );

    // Swallow the append so jsdom never sees a <script src> it cannot run,
    // and so the assertion "how many scripts were injected" is exact.
    jest.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLScriptElement) {
        appendedScripts.push(node);
        defineAtAppend.push(window.define);
      }
      return node;
    });

    TestBed.configureTestingModule({
      providers: [
        VimModeService,
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });
    service = TestBed.inject(VimModeService);

    // Turn vim mode on through the real preference path.
    mockRpcCall.mockResolvedValue({ success: true, data: { value: true } });
    await service.loadPreference();
    expect(service.enabled()).toBe(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    window.define = originalDefine;
    delete window.MonacoVim;
  });

  function attach(): { editor: object; statusBar: HTMLElement } {
    const editor = { id: 'editor-under-test' };
    const statusBar = originalCreateElement('div');
    service.attachToEditor(editor, statusBar);
    return { editor, statusBar };
  }

  describe('AMD define suppression', () => {
    it('hides the AMD define while the script runs and restores it on load', async () => {
      const amdDefine = makeAmdDefine();
      window.define = amdDefine;

      attach();

      expect(appendedScripts).toHaveLength(1);
      expect(defineAtAppend[0]).toBeUndefined();
      // Still hidden: the script has not executed yet.
      expect(window.define).toBeUndefined();

      createdScripts[0].onload?.(new Event('load'));
      await flush();

      expect(window.define).toBe(amdDefine);
    });

    it('restores the AMD define on error, so a 404 cannot break the loader', async () => {
      const amdDefine = makeAmdDefine();
      window.define = amdDefine;

      attach();

      expect(defineAtAppend[0]).toBeUndefined();

      createdScripts[0].onerror?.(new Event('error'));
      await flush();

      expect(window.define).toBe(amdDefine);
    });

    it('leaves the global alone when no define is present', async () => {
      window.define = undefined;

      attach();

      expect(appendedScripts).toHaveLength(1);
      expect(defineAtAppend[0]).toBeUndefined();

      createdScripts[0].onload?.(new Event('load'));
      await flush();

      expect(window.define).toBeUndefined();
    });

    it('leaves a non-AMD define untouched', async () => {
      const plainDefine = jest.fn() as unknown as NonNullable<Window['define']>;
      window.define = plainDefine;

      attach();

      // Never hidden: without `.amd` the UMD wrapper already takes the
      // global branch, so there is nothing to work around.
      expect(defineAtAppend[0]).toBe(plainDefine);

      createdScripts[0].onload?.(new Event('load'));
      await flush();

      expect(window.define).toBe(plainDefine);
    });
  });

  describe('terminal failure', () => {
    it('injects no second script after a load that produced no MonacoVim (the repeating "Can only have one anonymous define call per script file" error)', async () => {
      window.define = makeAmdDefine();

      attach();
      expect(appendedScripts).toHaveLength(1);

      // Script loaded, but the UMD global branch still did not run.
      createdScripts[0].onload?.(new Event('load'));
      await flush();

      expect(service.enabled()).toBe(false);

      // A second attach must not re-inject: a second anonymous define
      // reaching a loader that still holds the first is what threw.
      service.attachToEditor({ id: 'second' }, originalCreateElement('div'));
      await flush();

      expect(appendedScripts).toHaveLength(1);
    });

    it('is terminal on a failed fetch too', async () => {
      attach();

      createdScripts[0].onerror?.(new Event('error'));
      await flush();

      expect(service.enabled()).toBe(false);

      service.attachToEditor({ id: 'second' }, originalCreateElement('div'));
      await flush();

      expect(appendedScripts).toHaveLength(1);
    });
  });

  describe('happy path', () => {
    it('initializes vim on the editor and disposes it on detach', async () => {
      window.define = makeAmdDefine();

      const dispose = jest.fn();
      const initVimMode = jest.fn().mockReturnValue({ dispose });

      const { editor, statusBar } = attach();

      // The real script assigns this during execution, i.e. before onload.
      window.MonacoVim = { initVimMode };
      createdScripts[0].onload?.(new Event('load'));
      await flush();

      expect(initVimMode).toHaveBeenCalledTimes(1);
      expect(initVimMode).toHaveBeenCalledWith(editor, statusBar);
      expect(service.enabled()).toBe(true);

      service.detach();
      expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('reuses an already-loaded MonacoVim without injecting a script', () => {
      const dispose = jest.fn();
      const initVimMode = jest.fn().mockReturnValue({ dispose });
      window.MonacoVim = { initVimMode };

      const { editor, statusBar } = attach();

      expect(appendedScripts).toHaveLength(0);
      expect(initVimMode).toHaveBeenCalledWith(editor, statusBar);
    });
  });
});

import { Injectable, NgZone, inject } from '@angular/core';
import {
  NGX_MONACO_EDITOR_CONFIG,
  type NgxMonacoEditorConfig,
} from 'ngx-monaco-editor-v2';
import type * as monaco from 'monaco-editor';

type MonacoApi = typeof monaco;

interface AmdRequire {
  (modules: string[], cb: (...args: unknown[]) => void): void;
  config: (config: { paths: Record<string, string> }) => void;
}

type WindowWithMonaco = Window & {
  monaco?: MonacoApi;
  require?: AmdRequire;
};

/**
 * Minimal shape of Monaco's `languages.typescript` namespace that we use.
 * Recent `monaco-editor` type bundles narrow this namespace to `{ deprecated: true }`,
 * dropping the `*Defaults` handles from the public types even though they still
 * exist at runtime. We reach them through this structural type (the call sites are
 * guarded by optional chaining), consistent with this service's role of silencing
 * Monaco's type-level false positives.
 */
interface MonacoTsDiagnosticsDefaults {
  setDiagnosticsOptions(options: {
    noSemanticValidation: boolean;
    noSyntaxValidation: boolean;
    noSuggestionDiagnostics: boolean;
  }): void;
}

interface MonacoTypescriptLanguages {
  typescriptDefaults?: MonacoTsDiagnosticsDefaults;
  javascriptDefaults?: MonacoTsDiagnosticsDefaults;
}

/**
 * MonacoLoaderService — single coordination point for Monaco loading.
 *
 * Why this exists: `ngx-monaco-editor-v2` only loads Monaco when its
 * `<ngx-monaco-editor>` or `<ngx-monaco-diff-editor>` mounts, and its load
 * state is module-private. Components that drive Monaco directly (e.g. our
 * custom `DiffViewComponent` which uses the raw `monaco.editor.createDiffEditor`
 * API for proper diff decoration rendering) would otherwise be unable to know
 * when Monaco is ready and would either crash or silently render blank when
 * mounted before any ngx wrapper.
 *
 * Coordination contract:
 *   - We share `window.monaco` with ngx-monaco-editor-v2. Whoever loads first
 *     wins; the other side sees `window.monaco` and skips its own AMD path.
 *   - We never inject a second `loader.js` script if ngx has one in-flight
 *     (`[data-monaco-loader]` sentinel + existing `vs/loader.js` script check).
 *   - The AMD loader path mirrors ngx-monaco-editor-v2's BaseEditor logic so
 *     behaviour stays identical across Electron `file://` and webview `https://`.
 */
@Injectable({ providedIn: 'root' })
export class MonacoLoaderService {
  private readonly ngZone = inject(NgZone);
  private readonly config = inject(NGX_MONACO_EDITOR_CONFIG, {
    optional: true,
  }) as NgxMonacoEditorConfig | null;

  private loadPromise: Promise<MonacoApi> | null = null;

  /** Maximum time to wait for `window.monaco` to appear, in ms. */
  private static readonly LOAD_TIMEOUT_MS = 20_000;

  /** Polling interval while waiting for a parallel loader, in ms. */
  private static readonly POLL_INTERVAL_MS = 100;

  /** Guards `configureTypeScriptDefaults` so it only runs once per page. */
  private static tsDefaultsConfigured = false;

  /**
   * Silence Monaco's built-in TS/JS semantic validation.
   *
   * Monaco ships its own in-browser TypeScript worker that does NOT read the
   * workspace `tsconfig.json` (no `moduleResolution`, no `paths`) and only sees
   * files loaded as Monaco models. That combination makes it emit false
   * positives like TS2792 "Cannot find module '../services/x'. Did you mean to
   * set the 'moduleResolution' option to 'nodenext'…" for relative imports that
   * resolve perfectly fine on disk / in the real `tsc` build. Our panel is a
   * viewer/editor, not the project type-checker — VS Code's `tsserver` remains
   * the source of truth — so we disable semantic diagnostics while keeping
   * genuine syntax errors.
   */
  private configureTypeScriptDefaults(m: MonacoApi): void {
    if (MonacoLoaderService.tsDefaultsConfigured) return;
    const ts = m.languages?.typescript as unknown as
      | MonacoTypescriptLanguages
      | undefined;
    if (!ts) return;
    const diagnostics = {
      noSemanticValidation: true,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: true,
    };
    ts.typescriptDefaults?.setDiagnosticsOptions(diagnostics);
    ts.javascriptDefaults?.setDiagnosticsOptions(diagnostics);
    MonacoLoaderService.tsDefaultsConfigured = true;
  }

  load(): Promise<MonacoApi> {
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this.ngZone.runOutsideAngular(
      () =>
        new Promise<MonacoApi>((resolve, reject) => {
          const win = window as WindowWithMonaco;

          if (win.monaco) {
            this.configureTypeScriptDefaults(win.monaco);
            resolve(win.monaco);
            return;
          }

          let baseUrl = this.config?.baseUrl;
          if (!baseUrl || baseUrl === 'assets') {
            baseUrl = './assets/monaco/min/vs';
          }

          let pollHandle: ReturnType<typeof setInterval> | null = null;
          let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
          let settled = false;

          const cleanup = (): void => {
            if (pollHandle) clearInterval(pollHandle);
            if (timeoutHandle) clearTimeout(timeoutHandle);
            pollHandle = null;
            timeoutHandle = null;
          };

          const settle = (value: MonacoApi | Error): void => {
            if (settled) return;
            settled = true;
            cleanup();
            if (value instanceof Error) reject(value);
            else {
              this.configureTypeScriptDefaults(value);
              resolve(value);
            }
          };

          // Poll for window.monaco — handles the case where a parallel loader
          // (ngx-monaco-editor-v2 mounted concurrently) finishes our work.
          pollHandle = setInterval(() => {
            const m = (window as WindowWithMonaco).monaco;
            if (m) settle(m);
          }, MonacoLoaderService.POLL_INTERVAL_MS);

          timeoutHandle = setTimeout(() => {
            settle(
              new Error(
                `Monaco editor failed to load within ${MonacoLoaderService.LOAD_TIMEOUT_MS}ms (baseUrl=${baseUrl})`,
              ),
            );
          }, MonacoLoaderService.LOAD_TIMEOUT_MS);

          // If any loader script is already attached (either by ngx-monaco-editor
          // or a prior call to this service), the poll above will catch the load.
          const existingLoader = document.querySelector(
            'script[data-monaco-loader], script[src$="vs/loader.js"]',
          );
          if (existingLoader) return;

          const finalizeWithRequire = (req: AmdRequire | undefined): void => {
            const usedRequire = req ?? (window as WindowWithMonaco).require;
            if (!usedRequire) {
              return;
            }
            try {
              usedRequire.config({ paths: { vs: baseUrl as string } });
              usedRequire(['vs/editor/editor.main'], () => {
                const onLoad = this.config?.onMonacoLoad;
                if (typeof onLoad === 'function') {
                  try {
                    onLoad();
                  } catch {
                    // Honour ngx-monaco-editor-v2 semantics: an onMonacoLoad
                    // failure is non-fatal — Monaco itself is loaded.
                  }
                }
                const m = (window as WindowWithMonaco).monaco;
                if (m) settle(m);
              });
            } catch (err: unknown) {
              settle(
                err instanceof Error
                  ? err
                  : new Error(String(err ?? 'Monaco AMD require failed')),
              );
            }
          };

          const loaderScript = document.createElement('script');
          loaderScript.type = 'text/javascript';
          loaderScript.src = `${baseUrl}/loader.js`;
          loaderScript.setAttribute('data-monaco-loader', 'ptah');
          loaderScript.addEventListener('load', () =>
            finalizeWithRequire(undefined),
          );
          loaderScript.addEventListener('error', () =>
            settle(
              new Error(
                `Failed to load Monaco loader script: ${loaderScript.src}`,
              ),
            ),
          );
          document.body.appendChild(loaderScript);
        }),
    );

    return this.loadPromise;
  }
}

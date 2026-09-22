# Angular Routing Feasibility: Package Capability & Build Infrastructure

Investigation date: 2026-09-22.  
Scope: Static analysis of installed package versions in `node_modules`, workspace `package.json`, Nx build configurations, packaging copy steps, and in-repo router implementations.

---

## Installed versions

All packages listed below were inspected directly in `package.json` and verified against the installed `package.json` inside `node_modules/<package>/package.json`.

| Package | Installed Version (`node_modules`) | Dependency Type (`package.json`) | `package.json` Line | Specifier |
| --- | --- | --- | --- | --- |
| `@angular/core` | `22.1.7` | Direct (`dependencies`) | `package.json:93` | `"22.1.7"` |
| `@angular/common` | `22.1.7` | Direct (`dependencies`) | `package.json:91` | `"22.1.7"` |
| `@angular/router` | `22.1.7` | Direct (`dependencies`) | `package.json:98` | `"22.1.7"` |
| `@angular/build` | `22.1.8` | Direct (`devDependencies`) | `package.json:204` | `"22.1.8"` |
| `@angular/compiler` | `22.1.7` | Direct (`dependencies`) | `package.json:92` | `"22.1.7"` |
| `@angular/compiler-cli` | `22.1.7` | Direct (`devDependencies`) | `package.json:206` | `"22.1.7"` |
| `@angular/platform-browser` | `22.1.7` | Direct (`dependencies`) | `package.json:95` | `"22.1.7"` |
| `typescript` | `6.0.3` | Direct (`devDependencies`) | `package.json:283` | `"6.0.3"` |
| `nx` | `23.2.1` | Direct (`devDependencies`) | `package.json:272` | `"23.2.1"` |
| `zone.js` | `0.16.3` | Direct (`dependencies`) | `package.json:199` | `"0.16.3"` |

### Verification Citations
- `node_modules/@angular/core/package.json:3`: `"version": "22.1.7"`
- `node_modules/@angular/common/package.json:3`: `"version": "22.1.7"`
- `node_modules/@angular/router/package.json:3`: `"version": "22.1.7"`
- `node_modules/@angular/build/package.json:3`: `"version": "22.1.8"`
- `node_modules/@angular/compiler/package.json:3`: `"version": "22.1.7"`
- `node_modules/@angular/compiler-cli/package.json:3`: `"version": "22.1.7"`
- `node_modules/@angular/platform-browser/package.json:3`: `"version": "22.1.7"`
- `node_modules/typescript/package.json:3`: `"version": "6.0.3"`
- `node_modules/nx/package.json:3`: `"version": "23.2.1"`
- `node_modules/zone.js/package.json:3`: `"version": "0.16.3"`

---

## Router API available

Inspected in `node_modules/@angular/router/types/router.d.ts` and `node_modules/@angular/router/types/_router_module-chunk.d.ts` (the canonical re-export target configured in `node_modules/@angular/router/package.json:32`).

| Symbol / API | Present | Source File : Line | Quoted Declaration |
| --- | --- | --- | --- |
| `provideRouter` | Yes | `node_modules/@angular/router/types/router.d.ts:365` | `declare function provideRouter(routes: Routes, ...features: RouterFeatures[]): EnvironmentProviders;` |
| `withHashLocation` | Yes | `node_modules/@angular/router/types/router.d.ts:692` | `declare function withHashLocation(): RouterHashLocationFeature;` |
| `withComponentInputBinding` | Yes | `node_modules/@angular/router/types/router.d.ts:834` | `declare function withComponentInputBinding(options?: ComponentInputBindingOptions): ComponentInputBindingFeature;` |
| `withRouterConfig` | Yes | `node_modules/@angular/router/types/router.d.ts:658` | `declare function withRouterConfig(options: RouterConfigOptions): RouterConfigurationFeature;` |
| `withViewTransitions` | Yes | `node_modules/@angular/router/types/router.d.ts:863` | `declare function withViewTransitions(options?: ViewTransitionsFeatureOptions): ViewTransitionsFeature;` |
| `withPreloading` | Yes | `node_modules/@angular/router/types/router.d.ts:619` | `declare function withPreloading(preloadingStrategy: Type<PreloadingStrategy>): PreloadingFeature;` |
| `withInMemoryScrolling` | Yes | `node_modules/@angular/router/types/router.d.ts:409` | `declare function withInMemoryScrolling(options?: InMemoryScrollingOptions): InMemoryScrollingFeature;` |
| `withNavigationErrorHandler` | Yes | `node_modules/@angular/router/types/router.d.ts:738` | `declare function withNavigationErrorHandler(handler: (error: NavigationError) => unknown \| RedirectCommand): NavigationErrorHandlerFeature;` |
| `withDebugTracing` | Yes | `node_modules/@angular/router/types/router.d.ts:580` | `declare function withDebugTracing(): DebugTracingFeature;` |
| `withDisabledInitialNavigation` | Yes | `node_modules/@angular/router/types/router.d.ts:546` | `declare function withDisabledInitialNavigation(): DisabledInitialNavigationFeature;` |
| `withEnabledBlockingInitialNavigation` | Yes | `node_modules/@angular/router/types/router.d.ts:509` | `declare function withEnabledBlockingInitialNavigation(): EnabledBlockingInitialNavigationFeature;` |
| `loadComponent` | Yes | `node_modules/@angular/router/types/_router_module-chunk.d.ts:2573` | `loadComponent?: () => Type<unknown> \| Observable<Type<unknown> \| DefaultExport<Type<unknown>>> \| Promise<Type<unknown> \| DefaultExport<Type<unknown>>>;` |
| `loadChildren` | Yes | `node_modules/@angular/router/types/_router_module-chunk.d.ts:2676` | `loadChildren?: LoadChildren;` |
| `RouterOutlet` | Yes | `node_modules/@angular/router/types/_router_module-chunk.d.ts:1051` | `declare class RouterOutlet implements OnDestroy, OnInit, RouterOutletContract` |
| `Router.navigate` | Yes | `node_modules/@angular/router/types/_router_module-chunk.d.ts:1644` | `navigate(commands: readonly any[], extras?: NavigationExtras): Promise<boolean>;` |
| `RouterLink` | Yes | `node_modules/@angular/router/types/_router_module-chunk.d.ts:3812` | `declare class RouterLink implements OnChanges, OnDestroy {` |
| `provideZonelessChangeDetection` | Yes | `node_modules/@angular/core/types/core.d.ts:9676` | `declare function provideZonelessChangeDetection(): EnvironmentProviders;` |

---

## Build and chunking

1. **Webview build uses `@angular/build:application` (esbuild)**:
   - File: `apps/ptah-extension-webview/project.json:10`
   - Setting: `"executor": "@angular/build:application"`
   - Fact: The application builder is Angular's esbuild-based pipeline. It natively emits ES modules and performs automatic code splitting on dynamic `import()` calls (such as those invoked by `loadComponent` or `loadChildren`).

2. **Webview build outputs to nested `browser/` directory**:
   - File: `apps/ptah-extension-webview/project.json:13`
   - Setting: `"outputPath": "dist/apps/ptah-extension-webview"`
   - Fact: With `@angular/build:application`, client bundles are emitted into the subpath `dist/apps/ptah-extension-webview/browser/`.

3. **Output hashing and chunk naming configuration**:
   - File: `apps/ptah-extension-webview/project.json:69-70` (production) and line 89 (development)
   - Setting: `"outputHashing": "none"`, `"namedChunks": false`
   - Fact: Static entry files are emitted with fixed names (`main.js`, `polyfills.js`, `styles.css`). Lazy routes loaded via dynamic `import()` are emitted as numbered chunk files (e.g., `chunk-XYZ.js`).

4. **VS Code packaging uses recursive copy — NO copy-step risk for lazy chunks**:
   - Files: `apps/ptah-extension-vscode/project.json:83-99`, `scripts/copy-webview.js:10-28`
   - Fact: Target `"post-build-copy"` executes `node scripts/copy-webview.js` after building the webview. In `scripts/copy-webview.js:16-28`:
     ```js
     const src = 'dist/apps/ptah-extension-webview/browser';
     const dest = 'dist/apps/ptah-extension-vscode/webview/browser';
     fs.mkdirSync(dest, { recursive: true });
     fs.cpSync(src, dest, {
       recursive: true,
       filter: (source) => {
         const normalized = source.replace(/\\/g, '/');
         if (
           normalized.includes('/assets/monaco/') ||
           normalized.endsWith('/assets/monaco')
         ) {
           return false;
         }
         return true;
       },
     });
     ```
   - Conclusion: Because `fs.cpSync(src, dest, { recursive: true })` walks the entire directory tree and only excludes `/assets/monaco/`, any newly generated lazy chunk files emitted by esbuild into `dist/apps/ptah-extension-webview/browser/` are copied automatically into `dist/apps/ptah-extension-vscode/webview/browser/`. There is no whitelist of specific file names.

5. **Electron packaging uses recursive copy — NO copy-step risk for lazy chunks**:
   - Files: `apps/ptah-electron/project.json:312-319, 369`, `apps/ptah-electron/scripts/copy-renderer.js:23-72, 218-234`
   - Fact: The `"copy-renderer"` target runs `node apps/ptah-electron/scripts/copy-renderer.js`, which defines `copyRecursive(src, dst)`. Lines 48–71 walk `fs.readdirSync(src, { withFileTypes: true })` recursively, copying all files and subdirectories.
   - Conclusion: All lazy chunks emitted by the webview build are copied automatically into `dist/apps/ptah-electron/renderer/`.

6. **Electron base href rewriting**:
   - File: `apps/ptah-electron/scripts/copy-renderer.js:175`
   - Fact: The script modifies `index.html` via `.replace(/<base href="\/"\s*\/?>/i, '<base href="./">')` so that relative module requests resolve properly under the `file://` protocol.

7. **CRITICAL VS Code webview CSP blocker for dynamic imports**:
   - File: `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:269-278`
   - Fact: The CSP generated for the VS Code webview is:
     ```ts
     default-src 'none';
     img-src ${webview.cspSource} https: data: blob:;
     script-src 'nonce-${nonce}';
     style-src ${webview.cspSource} 'nonce-${nonce}' https://fonts.googleapis.com;
     font-src ${webview.cspSource} https://fonts.gstatic.com https://fonts.googleapis.com data:;
     connect-src 'self' ${webview.cspSource};
     frame-src 'none';
     object-src 'none';
     base-uri 'self' ${webview.cspSource};
     ```
   - Risk / Blocker: `script-src` contains ONLY `'nonce-${nonce}'`. It does NOT include `${webview.cspSource}` or `'strict-dynamic'`. When an ES module in the browser attempts to execute `import('./chunk-xxx.js')`, the dynamic import does not carry a script element nonce. Standard Chromium CSP blocks dynamic imports when `script-src` lacks the host origin or `'strict-dynamic'`. For lazy chunks to execute in VS Code, `webview-html-generator.ts:272` must be updated to include `${webview.cspSource}` (e.g., `script-src 'nonce-${nonce}' ${webview.cspSource};`).

8. **VS Code Webview History API restriction**:
   - File: `apps/ptah-extension-webview/src/app/app.config.ts:86-99`
   - Fact: The existing `WebviewErrorHandler` specifically traps `SecurityError` caused by `pushState` or `replaceState`:
     ```ts
     if (
       isError(error) &&
       error.name === 'SecurityError' &&
       (error.message?.includes('pushState') ||
         error.message?.includes('replaceState'))
     ) {
       console.warn(
         'WebView: History API error detected - this should not occur with pure signal navigation',
         error.message,
       );
       return;
     }
     ```
   - Conclusion: The default `PathLocationStrategy` in Angular Router calls `history.pushState` / `history.replaceState`, which triggers a `SecurityError` in standard VS Code webviews. Enabling routing in the webview requires `withHashLocation()` or a memory-backed location strategy.

9. **Current Zone vs. Zoneless Configuration**:
   - Files: `apps/ptah-extension-webview/project.json:15`, `apps/ptah-extension-webview/src/app/app.config.ts:117`
   - Fact: `ptah-extension-webview` currently loads `"polyfills": ["zone.js"]` and provides `provideZoneChangeDetection({ eventCoalescing: true })`. While Angular 22.1.7 supports `provideZonelessChangeDetection()`, the webview is not yet configured for zoneless. The Angular Router functions identically under both Zone.js and zoneless change detection.

---

## In-repo precedent

The monorepo already contains an active, production implementation of `provideRouter` and route-level lazy loading in `apps/ptah-landing-page`.

### 1. Router Provider Configuration
From `apps/ptah-landing-page/src/app/app.config.ts:17, 37-43`:

```ts
import { provideRouter, withInMemoryScrolling } from '@angular/router';
// ...
export const appConfig: ApplicationConfig = {
  providers: [
    // ...
    provideRouter(
      routes,
      withInMemoryScrolling({
        anchorScrolling: 'enabled',
        scrollPositionRestoration: 'enabled',
      }),
    ),
    // ...
  ],
};
```

### 2. Route Definitions with `loadComponent` and `loadChildren`
From `apps/ptah-landing-page/src/app/app.routes.ts:23-51, 101-107`:

```ts
export const routes: Routes = [
  {
    path: '',
    component: LandingPageComponent,
  },
  // ...
  {
    path: 'download',
    loadComponent: () =>
      import('./pages/download/download-page.component').then(
        (m) => m.DownloadPageComponent,
      ),
  },
  {
    path: 'pricing',
    loadComponent: () =>
      import('@ptah-web/pricing').then((m) => m.PricingPageComponent),
  },
  // ...
  {
    path: 'members',
    canActivate: [MemberGuard],
    loadChildren: () =>
      import('@ptah-web/members').then((m) => m.MEMBER_ROUTES),
    providers: [provideMarkdownRendering({ extensions: 'member' })],
    data: { hideFromNav: true },
  },
  // ...
];
```

### 3. Module Boundary Lint Rule Consideration
From code comments in `apps/ptah-landing-page/src/app/app.routes.ts:82-87`:
> `@nx/enforce-module-boundaries` errors on `"Static imports of lazy-loaded libraries are forbidden"` for any symbol pulled statically out of that same lib. `MemberGuard` and `MemberSessionStore` therefore live in `@ptah-web/core` — eagerly imported, never lazy... Moving either of them back into the member lib re-breaks this line.

This establishes an architectural pattern: any shared interfaces, guards, or services used in routing tables must reside in shared core libraries (`@ptah-extension/core`), rather than inside the lazy-loaded feature libraries.

---

## Unknowns

The following questions cannot be proven by static codebase analysis alone and require empirical runtime verification:

1. **Chromium Dynamic Import CSP Enforcement in VS Code Webview**:
   - `webview-html-generator.ts:272` currently specifies `script-src 'nonce-${nonce}';`.
   - Unknown: Whether appending `${webview.cspSource}` is sufficient on all target platforms and VS Code versions (1.90+) for Chromium to permit dynamic `import('./chunk-xxx.js')`, or if `'strict-dynamic'` or specific header flags are also required.

2. **Hash Location Persistence across Webview Panel Lifecycle**:
   - Unknown: When a VS Code webview panel is hidden, backgrounded, or serialized across workbench reloads, does the iframe retain its `#` URL hash fragment, or is the location reset to the root URL upon re-activation?

3. **Dynamic Import Relative Path Resolution under `vscode-webview:`**:
   - In `apps/ptah-extension-webview/src/index.html:6`, `<base href="/" />` is preserved verbatim by `WebviewHtmlGenerator:177-179`.
   - Unknown: While standard ES module `import()` resolves relative to `import.meta.url`, whether any esbuild chunk-loader runtime shim emitted by `@angular/build:application` references the `<base href>` tag or assumes standard web origins when requesting subsequent chunks.

4. **Coordination with `initialView` Host Parameters**:
   - In `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:147`, VS Code passes an `initialView` parameter (e.g. `'setup-wizard'`, `'analytics'`, `'orchestra'`).
   - Unknown: How the Angular Router's initial navigation will synchronize with the host's `initialView` without causing an initial double-render or routing race condition.

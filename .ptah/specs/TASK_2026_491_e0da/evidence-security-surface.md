# Browser-security surface sweep

Evidence for the Electron permission-handler / CSP work. Only product-relevant hits are emphasized; tooling/test hits are included because the request asked for "anywhere in the repository."

---

## 1. Electron permission handlers

| File | Line | Handler | What it does |
|------|------|---------|--------------|
| `apps\ptah-electron\src\windows\main-window.ts` | 136 | `setPermissionRequestHandler` | `callback(contents.id === mainWindow.webContents.id)` — grants the request only for the main window's own `webContents`. |
| `apps\ptah-electron\src\windows\main-window.ts` | 141 | `setPermissionCheckHandler` | `return contents === null \|\| contents.id === mainWindow.webContents.id` — allows checks only for the main window (or `null`). |

No `setDevicePermissionHandler` calls were found.

---

## 2. `BrowserWindow`, `BrowserView`, `WebContentsView` constructions and `webPreferences`

No `BrowserView` or `WebContentsView` constructions were found.

### `BrowserWindow` constructions

| File | Line | `webPreferences` | Notes |
|------|------|------------------|-------|
| `apps\ptah-electron\src\windows\main-window.ts` | 114 | 122-128: <br>```ts
preload: path.join(__dirname, 'preload.js'),
contextIsolation: true,
nodeIntegration: false,
sandbox: true,
webSecurity: true,
``` | No `partition` set; uses the default session. |
| `apps\ptah-electron\src\services\electron-browser-capabilities.ts` | 382 | 386-391: <br>```ts
contextIsolation: true,
nodeIntegration: false,
sandbox: true,
webSecurity: true,
``` | No `preload`, no `partition`. Window is created/destroyed per browser-capability session and is used for CDP-driven browsing. |

---

## 3. Content-Security-Policy strings built or set

### Product code

| File | Line(s) | Form | Relevant code |
|------|---------|------|---------------|
| `apps\ptah-extension-vscode\src\services\webview-html-generator.ts` | 140 | `<meta>` tag injection into parsed `index.html` | `<meta http-equiv="Content-Security-Policy" content="${cspContent}">` where `cspContent = this.getImprovedCSP(webview, nonce)` (line 136). |
| `apps\ptah-extension-vscode\src\services\webview-html-generator.ts` | 269-278 | CSP template literal | ```ts
return `default-src 'none';
        img-src ${webview.cspSource} https: data: blob:;
        script-src 'nonce-${nonce}';
        style-src ${webview.cspSource} 'nonce-${nonce}' https://fonts.googleapis.com;
        font-src ${webview.cspSource} https://fonts.gstatic.com https://fonts.googleapis.com data:;
        connect-src 'self' ${webview.cspSource};
        frame-src 'none';
        object-src 'none';
        base-uri 'self' ${webview.cspSource};`;
``` |
| `apps\ptah-extension-vscode\src\services\webview-html-generator.ts` | 305-308 | `<meta>` tag in fallback HTML | `<meta http-equiv="Content-Security-Policy" content="${this.getImprovedCSP(webview, nonce)}">` |
| `apps\ptah-electron\src\assets\preparing-workspace.html` | 6-7 | Static `<meta>` CSP | `content="default-src 'none'; style-src 'self'; script-src 'self'"` |
| `apps\ptah-license-server\src\main.ts` | 35 | Helmet option | `contentSecurityPolicy: false` — CSP is explicitly disabled for the API server. |
| `libs\frontend\webview-e2e-harness\src\lib\csp-stub.ts` | 42-43 | Header removal in Playwright route | ```ts
delete headers['content-security-policy'];
delete headers['content-security-policy-report-only'];
``` |
| `apps\ptah-electron\src\activation\state-storage-readiness-gate.spec.ts` | 26 | Test assertion on shell source | `expect(shellSource).toContain("default-src 'none'");` |

### Tooling / dev-time references (uncertain relevance)

| File | Line(s) | What it does |
|------|---------|--------------|
| `.claude\skills\impeccable\scripts\detect-csp.mjs` | 2, 15-25, 65, 70, 76, 81 | RegExp-based detection of CSP shapes in other projects; not a CSP setter. |
| `.claude\skills\impeccable\scripts\live-inject.mjs` | 448, 450, 454, 475, 496, 517-518, 520, 522 | Dev-server script that patches an existing `<meta http-equiv="Content-Security-Policy">` in served HTML. |

---

## 4. `setWindowOpenHandler`, `will-navigate`, `new-window` listeners, and navigation guards

| File | Line | Construct | Relevant code |
|------|------|-----------|---------------|
| `apps\ptah-electron\src\windows\main-window.ts` | 70 | `installNavigationGuard(mainWindow)` | Called immediately after the main `BrowserWindow` is created. |
| `apps\ptah-electron\src\windows\main-window.ts` | 71 | `will-navigate` listener | ```ts
window.webContents.on('will-navigate', (event, targetUrl) => {
  if (isSameDocumentNavigation(window.webContents.getURL(), targetUrl)) return;
  event.preventDefault();
  openExternalSafely(targetUrl);
});
``` |
| `apps\ptah-electron\src\windows\main-window.ts` | 79 | `setWindowOpenHandler` | ```ts
window.webContents.setWindowOpenHandler(({ url }) => {
  openExternalSafely(url);
  return { action: 'deny' };
});
``` |
| `apps\ptah-electron\src\windows\navigation-policy.ts` | 18, 47-58, 67-70 | Navigation-policy predicates | Defines `EXTERNAL_SChemes`, `isSameDocumentNavigation`, and `isSafeExternalUrl` used by the guard above. Not an event handler itself. |

No `new-window` listeners were found.

---

## 5. Custom protocol registrations

None found.

Searched for `registerSchemesAsPrivileged`, `protocol.handle`, `protocol.registerFileProtocol`, `protocol.registerStringProtocol`, `protocol.registerBufferProtocol`, `protocol.registerHttpProtocol`, `protocol.registerStreamProtocol`, and `registerStandardSchemes` across all TypeScript/JavaScript files.

---

## 6. `contextBridge.exposeInMainWorld` calls

All calls are in `apps\ptah-electron\src\preload.ts`.

| Line | Global name | Exposed shape |
|------|-------------|---------------|
| 23 | `vscode` | ```ts
{
  postMessage: (message: unknown) => ipcRenderer.send('rpc', message),
  getState: () => ipcRenderer.sendSync('get-state'),
  setState: (state: unknown) => ipcRenderer.send('set-state', state),
}
``` |
| 34 | `ptahConfig` | ```ts
{
  isVSCode: false,
  isElectron: true,
  theme: 'dark',
  workspaceRoot: startupConfig?.workspaceRoot || '',
  workspaceName: startupConfig?.workspaceName || '',
  extensionUri: '',
  baseUri: '',
  iconUri: './images/ptah-icon.png',
  userIconUri: './images/user-icon.png',
  panelId: 'electron-main',
  platform: process.platform,
  initialView: startupConfig?.initialView || 'chat',
}
``` |
| 48 | `ptahClipboard` | ```ts
{
  readText: (): Promise<string> => ipcRenderer.invoke('clipboard:read-text'),
  writeText: (text: string): void => ipcRenderer.send('clipboard:write-text', text),
}
``` |
| 60 | `ptahDiag` | ```ts
{
  captureCpuProfile: (durationMs?: number): Promise<string> =>
    ipcRenderer.invoke('diag:cpu-profile', durationMs),
}
``` |

The VS Code webview path does not use `contextBridge`; it uses VS Code's `acquireVsCodeApi()` inside a `<script>` block (`apps\ptah-extension-vscode\src\services\webview-html-generator.ts:401`) and assigns to `window.vscode` and `window.ptahConfig` directly in the generated HTML.

---

## 7. `<iframe>`, `<webview>` tag, and `srcdoc` usage

No `<webview>` tags were found in product code (only in comments).

| File | Line | Usage | Details |
|------|------|-------|---------|
| `libs\web\admin\src\lib\marketing\components\email-preview-frame\email-preview-frame.html` | 7 | `<iframe>` with `srcdoc` | ```html
<iframe
  [attr.sandbox]="''"
  [srcdoc]="srcdoc()"
  title="Email preview"
  class="w-full h-[420px] rounded-md border border-hairline bg-white">
</iframe>
``` |
| `libs\web\admin\src\lib\marketing\components\email-preview-frame\email-preview-frame.ts` | 91 | `srcdoc` computed property | ```ts
protected readonly srcdoc = computed<SafeHtml>(() =>
  this.sanitizer.bypassSecurityTrustHtml(this.cleanBody())
);
``` |
| `libs\web\members\src\lib\learning\youtube-player.html` | 29 | `<iframe>` with external `src` | ```html
<iframe
  #frame
  class="h-full w-full border-0"
  [src]="trustedUrl()"
  [title]="title()"
  allow="accelerometer; encrypted-media; picture-in-picture"
  allowfullscreen
  data-testid="video-frame">
</iframe>
``` |
| `libs\web\members\src\lib\learning\youtube-player.ts` | 150 | Comment only | Describes why the component renders `<iframe [src]>` itself. |
| `libs\web\members\src\lib\learning\youtube-player.spec.ts` | 148 | Test comment | `it('contains NO <iframe>', ...)` |

---

## Searches run

```bash
# 1. Permission handlers
rg -n -C3 "setPermissionRequestHandler|setPermissionCheckHandler|setDevicePermissionHandler" --glob="**/*.{ts,js,mjs}"

# 2. BrowserWindow / BrowserView / WebContentsView constructions
rg -n -A15 "webPreferences:\s*\{" --glob="**/*.{ts,js,mjs}"
rg -n -C2 "new BrowserWindow|new BrowserView|new WebContentsView" --glob="**/*.{ts,js,mjs}"

# 3. CSP strings
rg -n -C2 "Content-Security-Policy|default-src|script-src|style-src|img-src|frame-src|connect-src|object-src|base-uri" --glob="**/*.{ts,js,mjs,html}"

# 4. Window-open / navigation guards
rg -n -C3 "setWindowOpenHandler|will-navigate|new-window" --glob="**/*.{ts,js,mjs}"

# 5. Custom protocols
rg -n -C2 "registerSchemesAsPrivileged|protocol\.(handle|registerFileProtocol|registerStringProtocol|registerBufferProtocol|registerHttpProtocol|registerStreamProtocol|registerStandardSchemes)" --glob="**/*.{ts,js,mjs}"

# 6. contextBridge
rg -n -C5 "contextBridge\.exposeInMainWorld" --glob="**/*.{ts,js,mjs}"

# 7. iframe / webview / srcdoc
rg -n -C2 "<iframe|<webview|srcdoc" --glob="**/*.{html,ts,tsx}"

# Supplementary
rg -n -C2 "acquireVsCodeApi" --glob="apps/ptah-extension-vscode/**/*.ts"
rg -n -C2 "session\.defaultSession|webContents\.session|fromPartition|partition:\s*['\"]" --glob="**/*.{ts,js,mjs}"
rg -n -C2 "onHeadersReceived|webRequest|setCSP|contentSecurityPolicy|Content-Security-Policy-Report-Only" --glob="**/*.{ts,js,mjs,html}"
rg -n -C2 "webSecurity|nodeIntegration|contextIsolation|sandbox:\s*" --glob="**/*.{ts,js,mjs,html}"
```

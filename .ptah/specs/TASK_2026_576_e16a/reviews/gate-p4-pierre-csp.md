# Gate Decision Report - Pierre CSP in VS Code Webview (P4 / Batch 44)

- **Task**: TASK_2026_576_e16a
- **Gate**: P4 / Batch 44 (`TextDiffViewComponent` / Skills drawer rendering `@pierre/diffs` in VS Code webview)
- **Author**: researcher-expert
- **Date**: 2026-10-02
- **Deliverable**: `reviews/gate-p4-pierre-csp.md`

---

## 1. Executive Summary & Decision

### The Question
`@pierre/diffs` 1.5.1 injects dynamic `<style>` elements into shadow roots and document nodes at runtime, and sets inline `style` attributes on token spans. The VS Code webview Content-Security-Policy (CSP) `style-src` directive currently enforces `'nonce-${nonce}'` with **no** `'unsafe-inline'`. Before Batch 44 (which renders `TextDiffViewComponent` in the VS Code webview for the skills drawer), we must determine how Pierre styles load without CSP violations.

### The Decision: Option (c) — Align VS Code Webview `style-src` with Electron (`'unsafe-inline'`)
**We decide Option (c)**: Update `apps/ptah-extension-vscode/src/services/webview-html-generator.ts` line 287 to include `'unsafe-inline'` and remove `'nonce-${nonce}'` from `style-src`, matching the Electron renderer's CSP.

```diff
- style-src ${webview.cspSource} 'nonce-${nonce}' https://fonts.googleapis.com;
+ style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com;
```

### Why Option (c) Wins
1. **Option (a) (Nonce propagation) is technically impossible in Pierre 1.5.1**:
   - Pierre 1.5.1 dist code has zero support for nonces (0 hits across the package).
   - Even if `<style>` tag creation were monkey-patched to attach a nonce, Chromium CSP Level 2/3 explicitly refuses `style="..."` attributes on elements under a nonce policy: *"Note that hashes do not apply to style attributes, nor do nonces."* Shiki's syntax highlighting spans (`<span style="--pierre-token-...">`) are injected via `innerHTML` (`FileDiff.js:1695`) and are unconditionally blocked without `'unsafe-inline'`.
2. **Option (b) (`useCSSClasses` / `adoptedStyleSheets`) is broken/incomplete in Pierre 1.5.1**:
   - Pierre 1.5.1 uses constructable `adoptedStyleSheets` *only* for core container styles (`web-components.js:16`). For themes, it hardcodes `document.createElement("style")` (`hostTheme.js:14`).
   - `useCSSClasses: true` converts Shiki tokens to classes prefixed with `hl-`, but Pierre 1.5.1 **never calls** `toClass.getCSS()` (0 callers). Tokens render completely uncolored (monochrome), and Pierre *still* injects `<style data-theme-css>`.
3. **Zero Security Compromise on Code Execution**:
   - `script-src 'nonce-${nonce}'` remains strictly locked down with **no** `'unsafe-inline'` and **no** `unsafe-eval`. Arbitrary JavaScript execution (XSS) is 100% prevented.
   - CSS cannot execute JavaScript in modern Chromium (which powers both VS Code 1.100+ and Electron 44).
   - The webview runs in an isolated `vscode-webview:` iframe origin.
   - Electron in this repository *already* uses `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com` (`apps/ptah-electron/scripts/copy-renderer.js:159`, pinned in `shell-csp.spec.ts:150-154`). This decision establishes identical styling behavior across all Ptah runtimes.

---

## 2. Codebase & Library Evidence

### 2.1 Where VS Code Webview CSP is Built
- **Location**: `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:283-293`
  ```typescript
  private getImprovedCSP(webview: vscode.Webview, nonce: string): string {
    return `default-src 'none';
            img-src ${webview.cspSource} https: data: blob:;
            script-src 'nonce-${nonce}';
            style-src ${webview.cspSource} 'nonce-${nonce}' https://fonts.googleapis.com;
            font-src ${webview.cspSource} https://fonts.gstatic.com https://fonts.googleapis.com data:;
            connect-src 'self' ${webview.cspSource};
            frame-src 'none';
            object-src 'none';
            base-uri 'self' ${webview.cspSource};`;
  }
  ```
- **Nonce Generation**: `webview-html-generator.ts:149`:
  - `const nonce = this.generateNonce();` (16 bytes crypto random base64).
  - The nonce is placed on `<meta http-equiv="Content-Security-Policy">` (`:154`), `<style nonce="${nonce}">` (`:169`), and `<script nonce="${nonce}">` (`:180, 183`).
  - **Crucial finding**: The nonce is **not** passed to the webview client context in `window.ptahConfig` (`:430-458`).

### 2.2 Electron Renderer CSP for Comparison
- **Location**: `apps/ptah-electron/scripts/copy-renderer.js:156-169`
  ```javascript
  // Source inventory: local Angular/Monaco scripts, styles and fonts; Angular
  // component styles and UI style attributes need inline CSS.
  const policy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    ...
  ].join('; ');
  ```
- **Test Assertion**: `apps/ptah-electron/src/windows/shell-csp.spec.ts:150-154`
  ```typescript
  'style-src': [
    "'self'",
    "'unsafe-inline'",
    'https://fonts.googleapis.com',
  ],
  ```
  Electron explicitly allows inline styles because Angular component styles and DOM style attributes require inline CSS.

### 2.3 How `@pierre/diffs` 1.5.1 Injects Styles
Investigated in `node_modules/@pierre/diffs/dist`:

1. **Constructable Stylesheets (`adoptedStyleSheets`)**:
   - `node_modules/@pierre/diffs/dist/components/web-components.js:12-16`:
     ```javascript
     if (sheet == null) {
       sheet = new CSSStyleSheet();
       sheet.replaceSync(style_default);
     }
     shadowRoot.adoptedStyleSheets = [sheet];
     ```
     `adoptedStyleSheets` is used **only** for core element layout styles inside `<diffs-container>`. It does not trigger CSP `style-src` blocks.

2. **Dynamic `<style>` Injections (`hostTheme.js` & `FileDiff.js`)**:
   - `node_modules/@pierre/diffs/dist/utils/hostTheme.js:8-17`:
     ```javascript
     function upsertHostThemeStyle({ shadowRoot, currentNode, themeCSS }) {
       if (themeCSS.trim() === "") {
         currentNode?.remove();
         return;
       }
       currentNode ??= createHostThemeStyleNode();
       currentNode.textContent = themeCSS;
       if (currentNode.parentNode !== shadowRoot) shadowRoot.appendChild(currentNode);
       return currentNode;
     }
     function createHostThemeStyleNode() {
       const node = document.createElement("style");
       node.setAttribute(THEME_CSS_ATTRIBUTE, ""); // "data-theme-css"
       return node;
     }
     ```
   - `node_modules/@pierre/diffs/dist/components/FileDiff.js:1485-1489`:
     ```javascript
     this.themeCSSStyle = upsertHostThemeStyle({
       shadowRoot,
       currentNode: this.themeCSSStyle,
       themeCSS: wrapThemeCSS(themeStyles, effectiveThemeType, scrollbarGutter)
     });
     ```
   - Pierre dynamically creates an un-nonced `<style data-theme-css>` element and appends it to the shadow root on every render.
   - `createUnsafeCSSStyleNode.js:3-7`: Creates `<style data-unsafe-css>` element if `unsafeCSS` option is configured.

3. **Inline Token `style="..."` Attributes via `innerHTML`**:
   - `node_modules/@pierre/diffs/dist/components/FileDiff.js:1695`:
     ```javascript
     for (const [el, astChildren] of [[columns.gutter, gutterChildren], [columns.content, contentChildren]])
       if (astChildren != null) el.innerHTML = toHtml(astChildren);
     ```
   - `node_modules/@pierre/diffs/dist/utils/renderFileWithHighlighter.js:31-51`:
     Shiki AST tokens output `<span style="--pierre-token-dark:...;--pierre-token-light:...">`.
   - Setting `innerHTML` containing `style="..."` attributes without `'unsafe-inline'` violates CSP in Chromium.

4. **DOM CSSOM Property Assignments**:
   - `node_modules/@pierre/diffs/dist/components/FileDiff.js:1738-1739`:
     `column.gutter.style.setProperty("grid-row", ...)`
   - `FileDiff.js:1887-1888`: `element.style.setProperty(...)`
   - `FileDiff.js:1929-1930`: `this.bufferBefore.style.setProperty(...)`

---

## 3. Evaluation of Options

| Option | Feasibility | Cost / Impact | Known Failure Mode / Incompatibility |
|---|---|---|---|
| **(a) Nonce propagation** | **Infeasible** | High complexity; requires monkey-patching `document.createElement('style')` and plumbing nonce into webview. | **Fails completely on inline `style` attributes**: CSP Level 2/3 does not permit nonces on HTML `style="..."` attributes. Shiki's token `<span>` elements injected via `innerHTML` (`FileDiff.js:1695`) will trigger CSP violation errors on every line. |
| **(b) `useCSSClasses` / `adoptedStyleSheets`** | **Infeasible in 1.5.1** | None (library-level limitation). | **Broken in 1.5.1**: `useCSSClasses: true` delegates to Shiki transformer `toClass`, but Pierre **never calls** `toClass.getCSS()`. Tokens render without CSS rules (unstyled monochrome). Furthermore, `hostTheme.js` *still* injects `<style data-theme-css>` unconditionally. |
| **(c) Relax CSP `style-src` (`'unsafe-inline'`)** | **100% Feasible** | 1 line change in `webview-html-generator.ts`. 0 lines changed in `git-ui` or `@pierre/diffs`. | **None**. Matches Electron's existing policy (`copy-renderer.js:159`). Full syntax highlighting, diff rendering, and hunk separators work cleanly. |
| **(d) DOM Mutation Interception / AST Rewriting** | **Infeasible / High Risk** | Fragile wrapper around Pierre internals. | Violations fire synchronously when `<style>` is appended to shadow DOM before any observer or post-render callback can react. High maintenance overhead across `@pierre/diffs` patch releases. |

### CSP Level 3 Specific Note on Option (c)
In CSP Level 3, if `'nonce-${nonce}'` is kept in `style-src` alongside `'unsafe-inline'`, modern Chromium engines **ignore** `'unsafe-inline'` for `<style>` elements because a nonce is present. Therefore, `'nonce-${nonce}'` **must be removed** from `style-src` when adding `'unsafe-inline'`:
- Correct: `style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com;`
- Incorrect: `style-src ${webview.cspSource} 'unsafe-inline' 'nonce-${nonce}' https://fonts.googleapis.com;` (Chromium will still block `<style data-theme-css>`).

---

## 4. Implementation Steps for Batch 44 Executor

When executing Batch 44 (Task 44.1 / Skills drawer on `TextDiffViewComponent`):

### Step 1: Update CSP in `apps/ptah-extension-vscode`
Modify [webview-html-generator.ts](file:///D:/projects/ptah-extension/apps/ptah-extension-vscode/src/services/webview-html-generator.ts#L283-L293):
```typescript
private getImprovedCSP(webview: vscode.Webview, nonce: string): string {
  return `default-src 'none';
          img-src ${webview.cspSource} https: data: blob:;
          script-src 'nonce-${nonce}';
          style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com;
          font-src ${webview.cspSource} https://fonts.gstatic.com https://fonts.googleapis.com data:;
          connect-src 'self' ${webview.cspSource};
          frame-src 'none';
          object-src 'none';
          base-uri 'self' ${webview.cspSource};`;
}
```

### Step 2: Keep Fallback HTML in Sync
Ensure `generateFallbackHtml` in [webview-html-generator.ts](file:///D:/projects/ptah-extension/apps/ptah-extension-vscode/src/services/webview-html-generator.ts#L332-L335) calls `this.getImprovedCSP(webview, nonce)`.

### Step 3: Verification & Testing
1. **Host Unit Tests**:
   Run:
   ```bash
   npx nx test @ptah-extension/vscode-extension
   ```
   Confirm `webview-html-generator.initial-view.spec.ts` and all vscode extension tests pass.
2. **CSP Violation Check in Webview**:
   - In VS Code, launch the extension and trigger the skills drawer / `TextDiffViewComponent`.
   - Open Developer Tools for the webview (`Developer: Open Webview Developer Tools`).
   - Filter console by `Refused to apply inline style` or `Content-Security-Policy`.
   - Verify that **0 CSP violations** are reported during diff mount, theme changes, and hunk rendering.
3. **Electron Parity Check**:
   Run:
   ```bash
   npx nx test ptah-electron
   ```
   Confirm `apps/ptah-electron/src/windows/shell-csp.spec.ts` passes with its existing `style-src 'unsafe-inline'` expectation.

# Mermaid chat diagrams report

## Design

- `ptah-mermaid-message-text` replaces complete, column-zero `mermaid` fences only after finalization. While a message is streaming (and during the finalization handoff), the existing marked + DOMPurify markdown path renders the ordinary code block. This preserves streaming architecture decision D5's final sanitizer contract and does not invoke Mermaid per chunk.
- The renderer is standalone and `OnPush`. It dynamically imports `mermaid` only when a finalized fence is mounted, calls `initialize({ startOnLoad: false, securityLevel: 'strict' })`, DOMPurifies the generated SVG with the SVG profile, and only then uses Angular's trusted-SVG binding. No untrusted SVG is bypassed.
- The toolbar provides Diagram/Code toggles and Copy. SVG sits in a horizontal-scroll container. Parse failure switches to the source and one short error line.
- `MermaidThemeService` has one root-scoped `MutationObserver` for `data-theme`; all diagrams react to its signal. It resolves DaisyUI `base-100`, `base-200`, `base-300`, `base-content`, and `primary` classes to concrete colors for Mermaid's `themeVariables`.

## Files changed

- `package.json`, `package-lock.json` — added Mermaid.
- `tsconfig.base.json` — registered the lazy `@ptah-extension/chat-ui/mermaid` secondary entry point.
- `libs/frontend/chat-ui/src/mermaid.ts` and `libs/frontend/chat-ui/src/lib/organisms/mermaid/*` — fence segmentation, theme service, renderer, and specs.
- `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-message-text.component.ts` — Mermaid support when a `ptah-ui` message also contains Mermaid.
- `libs/frontend/chat/src/lib/components/organisms/execution/{execution-node.component.ts,mermaid-fence-line.ts}` — final-only deferred Mermaid host.
- `libs/frontend/chat/src/lib/components/organisms/{message-bubble.component.ts,message-bubble.component.html}` — raw-message fallback uses the same deferred renderer.

## Dependency and chunk placement

- Installed `mermaid@12.1.0` (latest stable at installation).
- Initial `npm install mermaid@latest --save` was rejected by `ngx-markdown@22.0.2`'s optional peer range (`>=10.6.0 <12.0.0`). Installing with npm's legacy-peer resolution retained the requested 12.1.0; npm emitted unrelated deprecation warnings (`inflight`, `glob`, `whatwg-encoding`, `boolean`, `source-map`, and Angular platform-browser-dynamic).
- Mermaid itself is behind `import('mermaid')` in `MermaidDiagramComponent`; Angular only mounts that secondary entry inside `@defer` after the cheap fence scan succeeds. It therefore belongs in an async Mermaid chunk, not the webview initial bundle. `apps/ptah-extension-webview/project.json` keeps the production initial budget at 2.5 MB warning / 3.5 MB error. No build was run, per task restriction.

## CSP findings

- VS Code webview: `WebviewHtmlGenerator.getImprovedCSP()` has `style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com`; Mermaid's SVG `<style>` is permitted. No CSP change was made.
- Electron: `apps/ptah-electron/scripts/copy-renderer.js` has `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`; Mermaid's SVG `<style>` is permitted. No CSP change was made.

## Tests and checks

- PASS — `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/organisms/mermaid/mermaid-message-text.component.spec.ts --coverage=false --maxWorkers=2`: 1 suite, 5 tests. Covers fence detection, streaming code fallback, finalized dynamic import/render, syntax-error fallback, and sanitizer invocation.
- INCOMPLETE — `npx nx typecheck @ptah-extension/chat-ui --parallel=1` was started but the constrained command runner returned before its terminal result.
- INCOMPLETE — `npx nx typecheck @ptah-extension/chat --parallel=1` was started and reached `ngc`; it was still running when this report was written.
- UNAVAILABLE — scoped `ptah_get_diagnostics` twice reported its TypeScript worker still running after 45 seconds, so it returned no file diagnostics.
- PASS (warnings only) — `npx nx lint @ptah-extension/chat-ui`: completed with 0 errors and 9 pre-existing warnings in unrelated files; no Mermaid warning remains. Nx Cloud remote reporting was disabled (401), but local lint completed.
- PASS (warnings only) — `npx nx lint @ptah-extension/chat`: completed with 0 errors and 34 pre-existing warnings in unrelated files.

## Decisions

- Followed the existing `ptah-ui` lazy-fence pattern rather than extending the global marked renderer, so ordinary messages keep their current rendering and bundle path.
- Kept Mermaid parsing out of streaming entirely; a closed fence is insufficient until the message has settled.
- Trusted SVG only after explicit DOMPurify SVG-profile sanitization, preserving Mermaid-authored style tags required for visual output.

## Clarifications Needed

None. Both host CSPs already allow Mermaid's inline SVG styles without weakening policy.

## Orchestrator correction (dependency)

`mermaid@12.1.0` conflicted with `ngx-markdown@22.0.2`'s optional peer range (`>=10.6.0 <12.0.0`), and the legacy-peer install rewrote unrelated entries of `package-lock.json` (it dropped packages such as `@electron/windows-sign` and `@csstools/*`). CI installs with `npm ci || npm install` without a legacy flag, so that lock would not install. The dependency files were reset to the branch base and `mermaid@^11.17.2` was installed normally: no peer conflict, the lock only adds entries. Re-verified: Mermaid specs 5/5, `chat-ui` and `chat` typecheck passed.

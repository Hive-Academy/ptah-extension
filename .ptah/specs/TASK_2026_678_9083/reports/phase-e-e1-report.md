## Changes

- B1: `libs/frontend/command-center/src/lib/voice/pcm-capture.ts:63` loads the packaged worklet URL relative to `document.baseURI`; `:102` retains `CaptureError('worklet')` on failure. `libs/frontend/command-center/src/assets/pcm-capture.worklet.js:1` contains the former inline processor unchanged in behavior. `apps/ptah-extension-webview/project.json:27` copies it to `assets/command-center/`.
- M1: `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:135` allows the tab strip to shrink and scroll horizontally; `:138-205` prevents every tab label, including Command Center and Setup hub, from wrapping.

## Specs added or changed

- `libs/frontend/command-center/src/lib/voice/pcm-capture.spec.ts:56` checks the packaged asset URL, and `:72` checks that a module load rejection becomes `CaptureError('worklet')` and releases the microphone and audio context.
- Scoped `ptah_get_diagnostics` was attempted twice after edits; TypeScript checks remained unavailable after the tool's 45-second timeout. No test, build, or Electron smoke command was run, per the batch's verification rule.

## Decisions

- **Use a packaged asset and leave `script-src 'self'` unchanged.** Options: same-origin asset or CSP `blob:` allowance. Evidence: `copy-renderer.js` sets `script-src 'self'`; the Electron renderer uses `<base href="./">`; Chromium documents `'self'` as matching URLs with the document's scheme ([Chromium CSP test](https://chromium.googlesource.com/chromium/src/+/e17bad76919b928905376d4e33f847406fdb7d09%5E%21)). This does not prove an AudioWorklet load in this exact Electron runtime; the orchestrator's smoke check is still needed. Reversible: yes.
- **Remove the blob path entirely.** Options: retain a conditional blob fallback or use only the shipped asset. Evidence: the only production path uses the Electron renderer, whose current policy blocks blob worklets; a fallback would fail under that policy and obscure the load failure. The existing worklet error remains. Reversible: yes.
- **Keep full tab names and allow horizontal scrolling.** Options: scroll or hide labels at a breakpoint. Evidence: the finding affects label wrapping at 892-900 px, and scrolling preserves the existing visible names and actions. Reversible: yes.

## Not done

- No real Electron CSP smoke check or tests were run; the orchestrator owns those checks. The scoped diagnostics tool timed out and reported the files unchecked.
- No CSP or CSP spec change was made because the packaged asset is the narrower fix.

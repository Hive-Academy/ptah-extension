# Batch 10 report

## Files changed

- libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts
- .claude/skills/ptah-surface-authoring/SKILL.md
- apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/SKILL.md

## Bridge snippet copied from the skill
```html
<script>
let nonce = null;
const sendHeight = () => {
  if (!nonce) return;
  const px = Math.max(160, Math.min(1600,
    Math.ceil(document.documentElement.scrollHeight)));
  parent.postMessage({ type: 'height', px, nonce }, '*');
};
addEventListener('message', (event) => {
  if (event.source !== parent) return;
  const data = event.data;
  if (data?.type !== 'theme' || !['light', 'dark'].includes(data.mode) ||
      typeof data.nonce !== 'string' || !data.vars ||
      typeof data.vars !== 'object') return;
  nonce = data.nonce;
  document.documentElement.dataset.theme = data.mode;
  for (const [name, value] of Object.entries(data.vars)) {
    if (typeof value === 'string') document.documentElement.style.setProperty(name, value);
  }
  sendHeight();
});
new ResizeObserver(sendHeight).observe(document.documentElement);
addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!link) return;
  const url = new URL(link.href, location.href);
  if (!['http:', 'https:'].includes(url.protocol)) return;
  event.preventDefault();
  if (nonce) parent.postMessage({ type: 'open-link', url: url.href, nonce }, '*');
});
</script>
```
## Schema and implementation checks

- artifact.schemas.ts lines 73-84: theme has type, mode, vars and nonce; mode is light or dark, nonce is 16-128 characters, and vars are restricted to the eleven names listed in the skill.
- artifact.schemas.ts lines 86-102: height has type, integer px in 160-1600, and nonce; open-link has type, HTTP(S) url, and nonce.
- artifact-theme-bridge.service.ts lines 101-104 sends the theme after frame load; artifact-viewer.component.ts lines 344-357 accepts page messages only from its frame with a valid schema and matching nonce.
- artifact-protocol.ts lines 5-11 allows inline script/style and data/blob images while blocking network connections, fonts, forms and child frames.
- artifact-tools.ts lines 13-19 verifies the publish name, one HTML file, inline assets, source arguments and desktop-only display.
- The bridge listens only to its parent, applies the received mode and vars, echoes the current nonce, clamps and rounds height, and routes HTTP(S) anchor clicks through open-link.

## Verification

- Command: NX_NO_CLOUD=true npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/vendor-roster-drift.spec.ts --coverage=false --maxWorkers=2 (PowerShell output limited to the last 25 lines). Result: 1 suite passed, 56 tests passed.
- cmp equivalent on Windows: fc.exe /b .claude/skills/ptah-surface-authoring/SKILL.md apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/SKILL.md. Result: no differences, exit 0.
- Scoped ptah_get_diagnostics was called after edits. It returned unavailable because the TypeScript check was still running after 45 seconds; the targeted Jest run compiled and passed.

## Decisions

- Kept the bridge snippet in SKILL.md instead of creating a reference file. The skill remains short enough, and agents can see the protocol while authoring. Reversible.
- Used data: images in authoring guidance although CSP also permits blob:, as requested for self-contained pages. Reversible.

---
name: ptah-surface-authoring
description: Authors ptah-ui blocks the host renders from verified data. Use for a turn summary, stats, file changes, test results, a chart, usage or plan limits in Ptah chat or the display panel. Marketing copy is technical-content-writer. A visual-system spec is ui-ux-designer. Those siblings may still apply when the task also asks for copy or a design system.
---

Use a `ptah-ui` block for a compact recap, a comparison, a small set of statistics, changed files, test results, subagent usage, CLI plan limits, or a chart. Use ordinary prose for normal explanation, and use ordinary code fences for code the user needs to copy.

Two targets exist. A plain ` ```ptah-ui ` fence renders inline in the message. A ` ```ptah-ui display ` or ` ```ptah-ui display <id> ` fence sends the same block to the side display panel. Reusing an id replaces that panel surface in place, so a dashboard can be refreshed instead of repeated.

Prefer host-backed sources over repeating information the host already owns. Write the source reference and let the host render the real values; never type file lists, test counts, costs, agent names or limits that a source provides. This keeps the reply compact and saves context tokens.

| Source    | Gives you                                                                              |
| --------- | -------------------------------------------------------------------------------------- |
| `$diff`   | Changed files of this turn: file, addition and deletion counts, per-file rows          |
| `$tests`  | Test runs of this turn: totals and one row per command                                 |
| `$usage`  | Tokens, cost and duration of this turn                                                 |
| `$agents` | Subagents and CLI lanes: counts, tokens, cost, per-agent rows with duration and context |
| `$limits` | Plan limits of the CLI lanes: per lane and window, used, state and reset               |

`$agents session` (and `$agents.session.<field>`) widens `$agents` from this turn to every turn of the session up to and including the block's own turn, never a later one. No other source takes `session`.

Blocks render only in the Ptah Electron app. An invalid block, or a `display` block that is invalid, stays an ordinary code block with a short reason line, and the display panel is left unchanged. Keep the grammar exact.

Read [the ptah-ui reference](references/ptah-ui.md) before authoring a block: it carries the grammar, the display and id rules, the `$agents` and `$limits` details, worked examples and common mistakes. For the interactive surface contract read [the surface catalog reference](references/catalog.md): it documents every `dashboard-catalog/3` component kind with one validated JSON example per kind, and lists the `dashboard-catalog/4` kinds that ptah-ui blocks produce.

## HTML artifacts

Keep `ptah-ui` as the default for short host-verified summaries. When the user asks for a substantial visual page such as a dashboard, report or prototype, publish an HTML artifact with `ptah_artifact_publish`. Artifacts display in the Ptah desktop app. Supply a title and exactly one of `html` or `path`; the page is one self-contained `index.html` of at most 2 MiB UTF-8.

Use semantic HTML and keyboard-operable controls. Make the layout responsive from 360 px and respond to the host's light/dark theme message. Keep CSS and JavaScript inline. CSP blocks network requests, CDNs, remote fonts and remote images; use data: images and prefer inline SVG or canvas charts with your own small chart code instead of a library. After publishing, describe the artifact in one sentence without pasting its HTML. Visually check it only when a browser tool can load the page; otherwise say no visual check ran. Never claim a screenshot you did not take.

The host sends `{ type: 'theme', mode: 'light' | 'dark', vars, nonce }` after frame load and on theme changes. Only these CSS variables are sent: `--b1`, `--b2`, `--b3`, `--bc`, `--bcm`, `--ptah-gold`, `--ptah-accent-ink`, `--ptah-link`, `--state-ink-err`, `--state-ink-done`, `--surface-highlight`. Echo the current nonce in each page-to-host message. The host checks the frame source, schema and nonce; height must be an integer from 160 to 1600 px, and links must be HTTP(S). This minimal bridge belongs in the page's inline script:

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

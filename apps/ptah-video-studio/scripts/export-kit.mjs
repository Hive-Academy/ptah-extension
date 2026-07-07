/**
 * export-kit.mjs — assemble a copy-pasteable "video showcase kit" from the live
 * engine so it can be dropped into another Nx workspace.
 *
 * The kit is GENERATED from the current source (never a hand-maintained fork, so
 * it can't drift). It gathers the three engine units + the Claude skill/agent +
 * a README into `dist/video-showcase-kit/`:
 *
 *   dist/video-showcase-kit/
 *     apps/<studio>/                 ← Remotion compositor + scripts (this app)
 *     libs/showcase-manifest/        ← shared beats/shots types
 *     showcase-harness/              ← _harness (Director + launchers) + scenes + scripts
 *     .claude/skills/video-showcase/ ← the skill + reference docs
 *     .claude/agents/video-director.md
 *     README.md                      ← what this is + pointer to install.md
 *
 * Build artifacts, node_modules, secrets (.env), and local caches (.whisper) are
 * excluded. The Nx package alias (@ptah-extension/showcase-manifest) is left
 * intact — renaming it to the target scope is a documented install step
 * (reference/install.md Step 2), not something this script guesses.
 *
 * Usage:  node apps/ptah-video-studio/scripts/export-kit.mjs [--out <dir>]
 * ESM, Node >=22.9 (uses fs.cpSync filter).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs, WORKSPACE_ROOT, APP_ROOT } from './paths.mjs';

/** This app's dir name under apps/ (e.g. "ptah-video-studio"). */
const STUDIO_APP = path.basename(APP_ROOT);
/** The e2e app that hosts the capture harness. */
const E2E_APP = 'ptah-electron-e2e';

/** Path fragments never copied into the kit (build output, deps, secrets, caches). */
const EXCLUDE = [
  'node_modules',
  `${path.sep}dist${path.sep}`,
  `${path.sep}out${path.sep}`,
  '.whisper',
  '.env',
  '.DS_Store',
  'render-props.json',
];

function shouldCopy(src) {
  const norm = src.split('/').join(path.sep);
  return !EXCLUDE.some((frag) =>
    frag.startsWith(path.sep) || frag.endsWith(path.sep)
      ? norm.includes(frag)
      : path.basename(norm) === frag || norm.includes(`${path.sep}${frag}${path.sep}`),
  );
}

function copyDir(srcAbs, destAbs, label) {
  if (!fs.existsSync(srcAbs)) {
    console.warn(`[kit] skip ${label}: not found at ${srcAbs}`);
    return;
  }
  fs.cpSync(srcAbs, destAbs, {
    recursive: true,
    filter: (s) => shouldCopy(s),
  });
  console.log(`[kit] copied ${label} -> ${path.relative(WORKSPACE_ROOT, destAbs)}`);
}

const README = `# Video Showcase Kit

A portable pipeline that turns automated UI walkthroughs into narrated,
captioned, camera-animated marketing MP4s. Playwright drives your app and
records a flat capture + a beats/shots manifest; Remotion renders it into a
polished video (virtual-camera zoom/pan, amber highlight rings, motion blur,
device frame, word-timed captions, AI narration, music bed).

## What's in here

| Folder | Role |
|---|---|
| \`apps/${STUDIO_APP}/\` | Remotion compositor + \`scripts/*.mjs\` (narrate/caption/render + camera grammar) |
| \`libs/showcase-manifest/\` | Shared \`beats\`/\`shots\` types — the capture↔render contract |
| \`showcase-harness/\` | The \`Director\` + Playwright fixtures (web + Electron launchers) + example scenes/scripts |
| \`.claude/skills/video-showcase/\` | The Claude skill + reference docs (install, scene authoring, camera/render, brand/runtime) |
| \`.claude/agents/video-director.md\` | A specialist subagent that authors scenes and drives capture→render |

## Install

Follow \`.claude/skills/video-showcase/reference/install.md\` step by step:
1. Copy \`apps/${STUDIO_APP}\`, \`libs/showcase-manifest\`, and \`showcase-harness/\`
   into your Nx workspace (harness goes under your e2e app's \`src/\`).
2. Rename the \`@ptah-extension/showcase-manifest\` package alias to your scope.
3. Add deps (remotion, @remotion/cli, zod, @playwright/test, ffmpeg-static, sharp, kokoro-js).
4. Re-skin via \`apps/${STUDIO_APP}/src/brand.config.ts\` (wordmark/productName/tagline/ctaLabel/theme).
5. Pick a capture runtime: web (browser-fixtures) or Electron (showcase-launcher).
6. Author a scene, capture, then \`node apps/${STUDIO_APP}/scripts/render-all.mjs --scene <slug>\`.

Drop the \`.claude/\` folder into your target repo too — the skill and subagent
then work there exactly as they do in this one.
`;

function main() {
  const args = parseArgs();
  const outDir =
    typeof args.out === 'string'
      ? path.resolve(WORKSPACE_ROOT, args.out)
      : path.join(WORKSPACE_ROOT, 'dist', 'video-showcase-kit');

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // Unit A — the Remotion studio app.
  copyDir(APP_ROOT, path.join(outDir, 'apps', STUDIO_APP), `apps/${STUDIO_APP}`);
  // Unit B — the shared manifest lib.
  copyDir(
    path.join(WORKSPACE_ROOT, 'libs', 'showcase-manifest'),
    path.join(outDir, 'libs', 'showcase-manifest'),
    'libs/showcase-manifest',
  );
  // Unit C — the capture harness (Director + fixtures + scenes + scripts).
  copyDir(
    path.join(WORKSPACE_ROOT, 'apps', E2E_APP, 'src', 'showcase'),
    path.join(outDir, 'showcase-harness'),
    'showcase-harness',
  );
  // The skill + subagent so the docs travel with the code.
  copyDir(
    path.join(WORKSPACE_ROOT, '.claude', 'skills', 'video-showcase'),
    path.join(outDir, '.claude', 'skills', 'video-showcase'),
    '.claude/skills/video-showcase',
  );
  const agentSrc = path.join(WORKSPACE_ROOT, '.claude', 'agents', 'video-director.md');
  if (fs.existsSync(agentSrc)) {
    const agentDest = path.join(outDir, '.claude', 'agents', 'video-director.md');
    fs.mkdirSync(path.dirname(agentDest), { recursive: true });
    fs.copyFileSync(agentSrc, agentDest);
    console.log('[kit] copied .claude/agents/video-director.md');
  }

  fs.writeFileSync(path.join(outDir, 'README.md'), README, 'utf8');
  console.log(`[kit] wrote README.md`);
  console.log(`[kit] Done. Kit assembled at ${outDir}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[kit] FAILED: ${message}`);
  process.exitCode = 1;
}

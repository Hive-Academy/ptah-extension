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
 * Build artifacts, node_modules, secrets (.env), local caches (.whisper) and the
 * founder's private self-shot ingest (`selfshot/<slug>/`, see SELFSHOT_KIT_SLUGS)
 * are excluded. The Nx package alias (@ptah-extension/showcase-manifest) is left
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

/** Self-shot ingest lives under `apps/<studio>/selfshot/<slug>/`. */
const SELFSHOT_DIR = 'selfshot';

/**
 * The ONLY self-shot slugs that ship in the kit.
 *
 * `selfshot/<slug>/` holds the founder's raw camera/screen recordings and their
 * whisper transcripts — private by construction and hundreds of MB. `_smoke` is
 * the deliberate exception: a tiny synthetic fixture (see selfshot/README.md)
 * that lets someone verify transcribe → draft → render in a fresh project, so
 * blanket-excluding `selfshot` would strip the kit of its own proof.
 *
 * This is an ALLOWLIST on purpose, not a blocklist of file types. Blocklisting
 * extensions leaks the next unanticipated artefact (a .mov, a notes.md, a second
 * transcript format); allowlisting slugs makes every newly recorded video
 * private by default, with no maintainer memory required.
 */
const SELFSHOT_KIT_SLUGS = new Set(['_smoke']);

/** Media containers that must never leave the repo unless inside a kit slug. */
const MEDIA_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.wav', '.mp3', '.m4a']);

/** Slugs the filter refused, reported once each at the end of the run. */
const skippedSelfshotSlugs = new Set();

function isDirectory(absPath) {
  return fs.statSync(absPath, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/**
 * If `absPath` is a self-shot slug directory or something inside one, return the
 * slug; otherwise null. Files sitting directly in `selfshot/` (the README) are
 * pipeline docs, not slug content, so they are not treated as a slug.
 */
function selfshotSlug(absPath) {
  const rel = path.relative(APP_ROOT, absPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts[0] !== SELFSHOT_DIR || parts.length < 2) return null;
  if (parts.length === 2 && !isDirectory(absPath)) return null;
  return parts[1];
}

function matchesExcludedFragment(norm) {
  return EXCLUDE.some((frag) =>
    frag.startsWith(path.sep) || frag.endsWith(path.sep)
      ? norm.includes(frag)
      : path.basename(norm) === frag || norm.includes(`${path.sep}${frag}${path.sep}`),
  );
}

function shouldCopy(src) {
  const norm = src.split('/').join(path.sep);
  if (matchesExcludedFragment(norm)) return false;

  const slug = selfshotSlug(norm);
  if (slug !== null && !SELFSHOT_KIT_SLUGS.has(slug)) {
    // Returning false on the slug dir itself stops cpSync recursing, so this
    // fires exactly once per excluded slug.
    skippedSelfshotSlugs.add(slug);
    return false;
  }
  return true;
}

/**
 * Post-copy alarm. `shouldCopy` is the fix; this is the smoke detector, so a
 * future edit to EXCLUDE / SELFSHOT_KIT_SLUGS / shouldCopy cannot silently
 * re-open the leak. Returns kit-relative paths of any private ingest that made
 * it through.
 */
function findLeakedIngest(outDir) {
  const kitSelfshot = path.join(outDir, 'apps', STUDIO_APP, SELFSHOT_DIR);
  if (!fs.existsSync(kitSelfshot)) return [];

  const leaked = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const parts = path.relative(kitSelfshot, abs).split(path.sep);
      const loose = parts.length === 1 && MEDIA_EXT.has(path.extname(entry.name).toLowerCase());
      if (loose || (parts.length > 1 && !SELFSHOT_KIT_SLUGS.has(parts[0]))) {
        leaked.push(`${SELFSHOT_DIR}/${parts.join('/')}`);
      }
    }
  };
  walk(kitSelfshot);
  return leaked;
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

It ships **two front ends onto one render engine**:

- **Showcase tours** — Playwright captures your app; the render is fully automated.
- **Self-shot videos** — you record yourself (camera and/or screen) in OBS and the
  same cinematic engine composites it in \`talking-head\`, \`screen-demo\` or
  \`hybrid\` mode. No AI narration there; captions come from a local whisper
  transcript of your own voice.

## What's in here

| Folder | Role |
|---|---|
| \`apps/${STUDIO_APP}/\` | Remotion compositor + \`scripts/*.mjs\` (narrate/caption/render + camera grammar) |
| \`apps/${STUDIO_APP}/src/selfshot/\` | Self-shot compositions (\`TalkingHead\`, \`ScreenDemo\`, \`Hybrid\`) + overlays |
| \`apps/${STUDIO_APP}/scripts/selfshot-*.mjs\` | Self-shot pipeline: \`transcribe\` (whisper) → \`draft\` (beats) → \`render\` |
| \`apps/${STUDIO_APP}/selfshot/_smoke/\` | Tiny synthetic fixture that verifies the self-shot pipeline in a fresh repo |
| \`libs/showcase-manifest/\` | Shared \`beats\`/\`shots\` types — the capture↔render contract |
| \`showcase-harness/\` | The \`Director\` + Playwright fixtures (web + Electron launchers) + example scenes/scripts |
| \`.claude/skills/video-showcase/\` | The Claude skill + reference docs (install, scene authoring, camera/render, brand/runtime) |
| \`.claude/agents/video-director.md\` | A specialist subagent that authors scenes and drives capture→render |

> Real self-shot footage is **not** in this kit. \`export-kit.mjs\` ships only the
> \`_smoke\` slug; every other \`selfshot/<slug>/\` is private source recording and is
> excluded at export time.

## Install

Follow \`.claude/skills/video-showcase/reference/install.md\` step by step:
1. Copy \`apps/${STUDIO_APP}\`, \`libs/showcase-manifest\`, and \`showcase-harness/\`
   into your Nx workspace (harness goes under your e2e app's \`src/\`).
2. Rename the \`@ptah-extension/showcase-manifest\` package alias to your scope.
3. Add deps (remotion, @remotion/cli, zod, @playwright/test, ffmpeg-static, sharp, kokoro-js).
4. Re-skin via \`apps/${STUDIO_APP}/src/brand.config.ts\` (wordmark/productName/tagline/ctaLabel/theme).
5. Pick a capture runtime: web (browser-fixtures) or Electron (showcase-launcher).
6. Author a scene, capture, then \`node apps/${STUDIO_APP}/scripts/render-all.mjs --scene <slug>\`.
7. Verify the self-shot side with the bundled fixture:
   \`npm run selfshot:render -- --slug _smoke --range 0-40\` (see
   \`apps/${STUDIO_APP}/selfshot/README.md\` and \`RECORDING.md\`).

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

  // Say out loud what was withheld — a maintainer adding a slug should not have
  // to read this file to learn their recording is (correctly) not shipping.
  const kept = [...SELFSHOT_KIT_SLUGS].join(', ');
  for (const slug of [...skippedSelfshotSlugs].sort()) {
    console.log(
      `[kit] EXCLUDED ${SELFSHOT_DIR}/${slug}/ — private self-shot ingest. ` +
        `The kit ships only: ${kept}. To ship another slug, add it to SELFSHOT_KIT_SLUGS.`,
    );
  }

  const leaked = findLeakedIngest(outDir);
  if (leaked.length > 0) {
    fs.rmSync(outDir, { recursive: true, force: true });
    const sample = leaked.slice(0, 5).join(', ');
    throw new Error(
      `private self-shot ingest reached the kit — ${leaked.length} file(s): ` +
        `${sample}${leaked.length > 5 ? ', …' : ''}. Kit deleted rather than shipped. ` +
        `Fix shouldCopy()/SELFSHOT_KIT_SLUGS in scripts/export-kit.mjs.`,
    );
  }

  console.log(`[kit] Done. Kit assembled at ${outDir}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[kit] FAILED: ${message}`);
  process.exitCode = 1;
}

// =============================================================================
// Ptah Community theme — package + deploy
// =============================================================================
// Packages the theme into a Discourse-importable zip (`about.json` at the zip
// root) and pushes it to a Discourse instance via the admin API:
//
//   POST /admin/customize/themes/import   (multipart, field `bundle`)
//
// Passing `theme_id` makes Discourse UPDATE that theme in place
// (`RemoteTheme.update_zipped_theme`) instead of creating a duplicate — this is
// the same endpoint/field the official `discourse_theme` gem uses. Auth is the
// standard `Api-Key` / `Api-Username` header pair already used by the license
// server's DiscourseAdminProvider.
//
// The dev and prod paths are the SAME command — only --url / credentials differ.
//
// Usage:
//   node tools/deploy-theme.mjs --pack-only            # just build the zip
//   node tools/deploy-theme.mjs --url http://localhost:3001
//   node tools/deploy-theme.mjs --url https://community.ptah.live --yes
//
// Env:
//   DISCOURSE_THEME_API_KEY        (required to deploy)
//   DISCOURSE_THEME_API_USERNAME   (default: system)
//   DISCOURSE_THEME_ID             (omit on first install — prints the new id)
//
// Deliberately namespaced `DISCOURSE_THEME_*` rather than reusing the license
// server's `DISCOURSE_URL` / `DISCOURSE_API_KEY`: those point at PRODUCTION in a
// normal `.env`, and silently inheriting them would make a plain local
// `nx deploy` write to the live forum.
// =============================================================================

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

const THEME_ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

/**
 * Files/dirs that belong in a Discourse theme bundle. Allowlist rather than
 * denylist so repo-only files (README.md, project.json, tools/, the rails
 * fallback in scripts/) can never leak into a published theme.
 */
const BUNDLE_FILES = ['about.json', 'settings.yml'];
const BUNDLE_DIRS = [
  'assets',
  'common',
  'desktop',
  'mobile',
  'locales',
  'javascripts',
  'scss',
  'migrations',
];

function parseArgs(argv) {
  const args = { packOnly: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--pack-only') args.packOnly = true;
    else if (arg === '--yes') args.yes = true;
    else if (arg === '--set-default') args.setDefault = true;
    else if (arg === '--url') args.url = argv[++i];
    else if (arg === '--theme-id') args.themeId = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else {
      console.error(`[theme] unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return args;
}

/** Fail fast on a theme that Discourse would reject or silently misname. */
function validate() {
  const aboutPath = path.join(THEME_ROOT, 'about.json');
  if (!fs.existsSync(aboutPath)) {
    throw new Error('about.json is missing — not a valid Discourse theme');
  }

  let about;
  try {
    about = JSON.parse(fs.readFileSync(aboutPath, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`about.json is not valid JSON: ${reason}`);
  }

  if (!about.name) throw new Error('about.json is missing a "name"');

  // locales/en.yml carries theme_metadata.description; Discourse rejects the
  // import without it.
  if (!fs.existsSync(path.join(THEME_ROOT, 'locales', 'en.yml'))) {
    throw new Error('locales/en.yml is missing (required by Discourse)');
  }

  // Assets are referenced from SCSS as $<key>; a dangling path imports a theme
  // whose styles silently lose their logo.
  for (const [key, rel] of Object.entries(about.assets ?? {})) {
    if (!fs.existsSync(path.join(THEME_ROOT, rel))) {
      throw new Error(`about.json asset "${key}" points at missing file: ${rel}`);
    }
  }

  return about;
}

function pack(outPath) {
  const zip = new AdmZip();

  for (const file of BUNDLE_FILES) {
    const abs = path.join(THEME_ROOT, file);
    if (fs.existsSync(abs)) zip.addLocalFile(abs);
  }
  for (const dir of BUNDLE_DIRS) {
    const abs = path.join(THEME_ROOT, dir);
    if (fs.existsSync(abs)) zip.addLocalFolder(abs, dir);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  zip.writeZip(outPath);
  return zip.toBuffer();
}

/**
 * Discourse moved the admin theme routes under /admin/customize/ in recent
 * versions but still serves the original /admin/themes/ path on older ones
 * (which is what the official `discourse_theme` gem targets). Try the
 * long-stable path first, then the newer one, so dev and prod can sit on
 * different Discourse versions without config drift.
 */
const IMPORT_PATHS = ['/admin/themes/import', '/admin/customize/themes/import'];

async function deploy({ url, apiKey, apiUsername, themeId, buffer, name }) {
  const base = url.replace(/\/+$/, '');
  let response;
  let raw;

  for (const importPath of IMPORT_PATHS) {
    // Rebuilt per attempt — a FormData body is consumed by fetch.
    const form = new FormData();
    form.append(
      'bundle',
      new Blob([buffer], { type: 'application/zip' }),
      'theme.zip',
    );
    // Present => update this theme in place. Absent => Discourse creates a new one.
    if (themeId) form.append('theme_id', String(themeId));

    response = await fetch(`${base}${importPath}`, {
      method: 'POST',
      headers: {
        'Api-Key': apiKey,
        'Api-Username': apiUsername,
        Accept: 'application/json',
      },
      body: form,
    });
    raw = await response.text();

    // Only a 404 means "wrong path for this version" — anything else is a real
    // answer from the endpoint and must not be retried against the other path.
    if (response.status !== 404) break;
  }

  const isHtml = /^\s*<(!doctype|html)/i.test(raw);

  if (!response.ok) {
    // Discourse renders an HTML error page (not JSON) for auth failures, and
    // hides admin routes behind a 404 rather than a 403 when the key lacks
    // admin rights — so a bare status code is genuinely misleading here.
    if (response.status === 404) {
      throw new Error(
        'import failed: HTTP 404. Discourse hides admin routes from keys without ' +
          'admin rights, so this usually means DISCOURSE_THEME_API_KEY is scoped ' +
          'rather than Global. Create a Global-scope, single-user (admin) key ' +
          'under Admin > API > New API Key.',
      );
    }
    throw new Error(
      `import failed: HTTP ${response.status} ${response.statusText}` +
        (isHtml ? ' (HTML error page)' : ` — ${raw.slice(0, 300)}`),
    );
  }

  let theme;
  try {
    theme = JSON.parse(raw).theme;
  } catch {
    throw new Error(
      `import returned a non-JSON response${isHtml ? ' (HTML error page)' : `: ${raw.slice(0, 300)}`}`,
    );
  }

  console.log(
    `[theme] ${themeId ? 'updated' : 'created'} "${theme?.name ?? name}" (id: ${theme?.id})`,
  );
  if (!themeId) {
    console.log(
      `[theme] first install — pin this for future runs: DISCOURSE_THEME_ID=${theme?.id}`,
    );
  }
  return theme;
}

/**
 * Importing a theme does NOT make it the site default — that is a separate
 * one-time bootstrap step. Kept behind a flag rather than run on every deploy
 * so a routine content push can never silently re-point the live forum's theme.
 */
async function setDefault({ url, apiKey, apiUsername, themeId }) {
  const base = url.replace(/\/+$/, '');
  let response;

  for (const prefix of ['/admin/themes', '/admin/customize/themes']) {
    response = await fetch(`${base}${prefix}/${themeId}`, {
      method: 'PUT',
      headers: {
        'Api-Key': apiKey,
        'Api-Username': apiUsername,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ theme: { default: true } }),
    });
    if (response.status !== 404) break;
  }

  if (!response.ok) {
    throw new Error(
      `set-default failed: HTTP ${response.status} ${response.statusText}`,
    );
  }
  console.log(`[theme] set theme ${themeId} as the site default`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const about = validate();

  const outPath = path.resolve(
    args.out ??
      path.join(
        THEME_ROOT,
        '../../dist/apps/ptah-discourse-theme/ptah-community-theme.zip',
      ),
  );
  const buffer = pack(outPath);
  console.log(
    `[theme] packaged ${about.name} v${about.theme_version} -> ${outPath} (${(buffer.length / 1024).toFixed(1)} KB)`,
  );

  if (args.packOnly) return;

  const url = args.url;
  if (!url) {
    throw new Error('--url is required to deploy (or pass --pack-only)');
  }

  const apiKey = process.env.DISCOURSE_THEME_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'DISCOURSE_THEME_API_KEY is not set — create a Global-scope admin API key under Admin > API',
    );
  }
  const apiUsername =
    process.env.DISCOURSE_THEME_API_USERNAME?.trim() || 'system';
  const themeId = args.themeId ?? process.env.DISCOURSE_THEME_ID?.trim();

  // Guard against a local `nx deploy` accidentally writing to the live forum.
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:|\/|$)/.test(
    url,
  );
  if (!isLocal && !args.yes && !process.env.CI) {
    throw new Error(
      `refusing to deploy to a non-local target (${url}) without --yes`,
    );
  }

  console.log(`[theme] deploying to ${url} as ${apiUsername}...`);
  const theme = await deploy({
    url,
    apiKey,
    apiUsername,
    themeId,
    buffer,
    name: about.name,
  });

  if (args.setDefault) {
    await setDefault({ url, apiKey, apiUsername, themeId: theme?.id });
  }
}

main().catch((error) => {
  console.error(`[theme] ${error instanceof Error ? error.message : error}`);
  // exitCode (not process.exit) so Node drains stdio and tears the fetch stream
  // down cleanly — process.exit here trips a libuv assertion on Windows.
  process.exitCode = 1;
});

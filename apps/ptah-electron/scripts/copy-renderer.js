/**
 * Copy Renderer Script
 *
 * Copies the Angular webview build output to the Electron renderer directory.
 * Performs a clean copy (removes old files first) and patches index.html
 * for Electron's file:// protocol compatibility.
 *
 * Key fix: Changes <base href="/"> to <base href="./"> so that relative
 * script/style paths resolve correctly when loaded via file:// protocol.
 * In VS Code webviews, the base href is rewritten by the webview host,
 * but in Electron's loadFile() it must be relative.
 *
 * Run as a script (`node copy-renderer.js`) it does a clean copy — the
 * behaviour `nx copy-renderer` and `nx package` depend on. Required as a
 * module it exposes `syncRenderer({ clean })` so `watch-renderer.js` can do
 * additive syncs against a running dev window.
 */

const fs = require('fs');
const path = require('path');
const { createHash } = require('node:crypto');

const SOURCE = path.resolve(
  __dirname,
  '../../../dist/apps/ptah-extension-webview/browser',
);
const DEST = path.resolve(
  __dirname,
  '../../../dist/apps/ptah-electron/renderer',
);

// Walk SOURCE manually so broken symlinks (occasionally produced by npm's
// _cacache for monaco-editor's min/vs/basic-languages on Linux runners) are
// skipped rather than aborting the whole copy with a C++ filesystem_error.
function copyRecursive(src, dst) {
  let entries;
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      console.warn(
        `[copy-renderer] Skipping unreadable dir: ${src} (${err.code})`,
      );
      return;
    }
    throw err;
  }
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isSymbolicLink()) {
      // Follow the link; if target is missing, skip rather than abort.
      let stat;
      try {
        stat = fs.statSync(srcPath);
      } catch {
        console.warn(`[copy-renderer] Skipping broken symlink: ${srcPath}`);
        continue;
      }
      if (stat.isDirectory()) {
        copyRecursive(srcPath, dstPath);
      } else {
        fs.copyFileSync(srcPath, dstPath);
      }
    } else if (entry.isDirectory()) {
      copyRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// Every inline <script> the build emits is lifted out to its own file next to
// index.html, so script-src stays a bare 'self' and no hash exists to go
// stale. The earlier revision hashed the matched text in place, which meant
// any later whitespace edit to dist/index.html silently blocked the pre-paint
// theme bootstrap. A build-time nonce was rejected for the opposite reason: a
// nonce baked into a shipped file is a constant that an injected script can
// read straight back out of the DOM, so it protects nothing a hash would.
const INLINE_SCRIPT_PREFIX = 'inline-';
// Consumes the newline the insertion below puts BEFORE the tag, so stripping
// and re-inserting lands on exactly the same bytes.
//
// Matched in TWO steps on purpose. `[ \t]*` in front of a literal `<` rescans
// every whitespace run once per starting offset — quadratic over the whole
// built renderer HTML, which is what S8786 flagged. Bounding it fixes that.
// The attribute test is then a SEPARATE pattern rather than `[^>]*http-equiv`
// inside the same one, because a negated class in front of a literal it can
// also match is the very backtracking shape being avoided. Finding whole
// `<meta>` tags is unambiguous, and the attribute test runs once per tag
// against a short string. `[^>]*` stays open: a CSP `content` attribute is
// legitimately long, and a negated class before its own terminator cannot
// backtrack.
const META_TAG = /\n?[ \t]{0,32}<meta\b[^>]*>/gi;
// Attribute order is NOT fixed and the quotes may be single, double or absent.
// Anchoring on `http-equiv` being the first attribute let a reordered tag
// survive, and a surviving `default-src 'none'` intersects with the policy
// written below — Chromium enforces the intersection, which blocks the lifted
// `./inline-*.js` scripts and the renderer never starts.
const CSP_ATTR = /\bhttp-equiv\s*=\s*['"]?Content-Security-Policy['"]?/i;

/**
 * @param {string} html
 * @returns {{ html: string, scripts: Array<{ fileName: string, content: string }> }}
 *   `scripts` are the lifted inline scripts. The caller writes them beside
 *   index.html; `secureRendererHtml` itself touches no disk.
 */
function secureRendererHtml(html) {
  if (typeof html !== 'string' || !/<head\s*>/i.test(html)) {
    throw new Error('Renderer must be an HTML document with a head');
  }
  // Normalize CRLF as the HTML parser does, then drop any CSP meta a previous
  // run left behind. Without that removal a second run emits two conflicting
  // policies and the browser enforces the intersection.
  const normalized = html
    .replace(/\r\n?/g, '\n')
    .replace(META_TAG, (tag) => (CSP_ATTR.test(tag) ? '' : tag));
  const scripts = [];
  const withoutInlineScripts = normalized.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
    (match, attributes, body) => {
      if (/\bsrc\s*=/i.test(attributes)) return match;
      const fileName = `${INLINE_SCRIPT_PREFIX}${createHash('sha256')
        .update(body)
        .digest('hex')
        .slice(0, 16)}.js`;
      scripts.push({ fileName, content: body });
      // Keep the tag in place: the theme bootstrap must still run at this
      // exact point in the parse, before the build's styles.css link.
      return `<script${attributes} src="./${fileName}"></script>`;
    },
  );
  // file: responses cannot deliver HTTP headers. Meta is parsed BEFORE any
  // resource or script. frame-ancestors is ignored in meta and intentionally
  // absent; frame-src blocks shell children, and the navigation guard stays.
  // Source inventory: local Angular/Monaco scripts, styles and fonts; Angular
  // component styles and UI style attributes need inline CSS. styles.css imports
  // fonts.googleapis.com, whose fonts come from fonts.gstatic.com. Attachments
  // use data/blob images; local-tts-panel uses blob audio; Monaco uses workers.
  // Renderer network calls go over preload RPC: connect-src needs only local
  // resources, never backend provider URLs.
  //
  // img-src carries the `https:` scheme-source, matching the VS Code webview
  // policy at webview-html-generator.ts:270. Two shipped surfaces render an
  // image whose host is not knowable at build time: marketplace card icons
  // come from a third-party registry entry (smithery-surface.component.ts
  // `iconSrc`), and assistant markdown may carry any https image, which the
  // DOMPurify preset deliberately permits. No bounded host list exists for
  // either, so a host allowlist would be a guess that breaks in the field. It
  // is a scheme-source, not a wildcard host: http: and data: documents stay
  // denied, and img-src cannot execute script. See context.md, "Shell CSP".
  //
  // No embedding protection is claimed for this meta policy: frame-ancestors
  // would require a response header and a different document delivery scheme.
  const policy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' https: data: blob:",
    "font-src 'self' https://fonts.gstatic.com data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-src 'none'",
    "form-action 'none'",
  ].join('; ');
  // Replace <base href="/"> or <base href="/"/> with <base href="./"> for
  // Electron file:// loading. Already-relative bases are left alone, which is
  // what makes a second run a no-op.
  return {
    html: withoutInlineScripts
      .replace(/<base href="\/"\s*\/?>/i, '<base href="./">')
      .replace(
        /<head\s*>/i,
        `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`,
      ),
    scripts,
  };
}

function patchIndexHtml(logPrefix) {
  const indexPath = path.join(DEST, 'index.html');
  const patched = secureRendererHtml(fs.readFileSync(indexPath, 'utf8'));
  // Prune the previous run's lifted scripts so a changed bootstrap leaves no
  // orphan, but ONLY when this run lifted something. A second run over an
  // already-patched document finds no inline script and must not delete the
  // file the document now points at.
  const keep = new Set(patched.scripts.map((script) => script.fileName));
  if (keep.size > 0) {
    for (const entry of fs.readdirSync(DEST)) {
      if (
        entry.startsWith(INLINE_SCRIPT_PREFIX) &&
        entry.endsWith('.js') &&
        !keep.has(entry)
      ) {
        fs.rmSync(path.join(DEST, entry), { force: true });
      }
    }
  }
  for (const script of patched.scripts) {
    fs.writeFileSync(path.join(DEST, script.fileName), script.content, 'utf8');
  }
  fs.writeFileSync(indexPath, patched.html, 'utf8');
  console.log(
    `${logPrefix} Patched index.html: relative base, shell CSP, ${patched.scripts.length} inline script(s) lifted`,
  );
}

/**
 * @param {{ clean?: boolean, logPrefix?: string }} [options]
 *   clean — remove DEST first. Always true for packaging. The watcher passes
 *   false so a running window keeps finding the lazy chunks it already
 *   resolved; the next clean copy prunes them.
 */
function syncRenderer({ clean = true, logPrefix = '[copy-renderer]' } = {}) {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(
      `Source not found: ${SOURCE}\nRun "nx build ptah-extension-webview" first`,
    );
  }

  if (clean && fs.existsSync(DEST)) {
    fs.rmSync(DEST, { recursive: true, force: true });
    console.log(`${logPrefix} Cleaned old renderer directory`);
  }

  copyRecursive(SOURCE, DEST);
  console.log(`${logPrefix} Copied ${SOURCE} -> ${DEST}`);

  patchIndexHtml(logPrefix);
}

module.exports = { syncRenderer, secureRendererHtml, SOURCE, DEST };

if (require.main === module) {
  try {
    syncRenderer({ clean: true });
  } catch (err) {
    console.error(`[copy-renderer] ${err.message}`);
    process.exit(1);
  }
  console.log('[copy-renderer] Done');
}

#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  brotliCompressSync,
  constants as zlibConstants,
  gzipSync,
} from 'node:zlib';
import * as esbuild from 'esbuild';
import { parseCliFlags, walkFiles } from './live-demo-cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(HERE, '../..');
const DEFAULT_WEBVIEW_DIST = 'dist/apps/ptah-extension-webview/browser';
const DEFAULT_OUT_DIR = 'dist/ptah-landing-page/browser/demo';
const DEFAULT_SCENARIOS_DIR = 'libs/web/landing/src/lib/live-demo/scenarios';
const DEFAULT_BRIDGE_ENTRY =
  'libs/web/landing/src/lib/live-demo/runtime/replay-bridge.entry.ts';
const FONTS_SOURCE_DIR = join(
  WORKSPACE_ROOT,
  'libs/frontend/webview-e2e-harness/src/lib/fonts',
);

const GOOGLEAPIS_IMPORT_RE =
  /@import\s+(?:url\(\s*['"]?https?:\/\/fonts\.googleapis\.com\/[^)'"]+['"]?\s*\)|['"]https?:\/\/fonts\.googleapis\.com\/[^'"]+['"])\s*;?/gi;
const GOOGLE_FONT_LINK_RE =
  /\n?[ \t]{0,32}<link\b[^>]*\bhref\s*=\s*['"]?https?:\/\/fonts\.(?:googleapis|gstatic)\.com[^'">\s]*['"]?[^>]*>/gi;
const META_TAG_RE = /\n?[ \t]{0,32}<meta\b[^>]*>/gi;
const CSP_ATTR_RE =
  /\bhttp-equiv\s*=\s*['"]?Content-Security-Policy(?:-Report-Only)?['"]?/i;
const BRIDGE_SCRIPT_RE =
  /\n?[ \t]{0,32}<script\b[^>]*\bsrc\s*=\s*['"](?:\.\/|\/demo\/)?replay-bridge(?:\.[0-9a-f]+)?\.js['"][^>]*>\s*<\/script\s*>/gi;

// Fallback @font-face declarations if a non-inlined CSS build still has an @import to fonts.googleapis.com
const FALLBACK_GOOGLE_FONTS_CSS = [
  '@font-face{font-family:Cinzel;font-style:normal;font-weight:400 700;font-display:swap;src:url(fonts/s/cinzel/v26/8vIJ7ww63mVu7gt7-GT7LEc.woff2) format("woff2");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF}',
  '@font-face{font-family:Cinzel;font-style:normal;font-weight:400 700;font-display:swap;src:url(fonts/s/cinzel/v26/8vIJ7ww63mVu7gt79mT7.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}',
  '@font-face{font-family:Inter;font-style:normal;font-weight:300 700;font-display:swap;src:url(fonts/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2JL7SUc.woff2) format("woff2");unicode-range:U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F}',
  '@font-face{font-family:Inter;font-style:normal;font-weight:300 700;font-display:swap;src:url(fonts/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa0ZL7SUc.woff2) format("woff2");unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}',
  '@font-face{font-family:Inter;font-style:normal;font-weight:300 700;font-display:swap;src:url(fonts/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2ZL7SUc.woff2) format("woff2");unicode-range:U+1F00-1FFF}',
  '@font-face{font-family:Inter;font-style:normal;font-weight:300 700;font-display:swap;src:url(fonts/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1pL7SUc.woff2) format("woff2");unicode-range:U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF}',
  '@font-face{font-family:Inter;font-style:normal;font-weight:300 700;font-display:swap;src:url(fonts/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2pL7SUc.woff2) format("woff2");unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB}',
  '@font-face{font-family:Inter;font-style:normal;font-weight:300 700;font-display:swap;src:url(fonts/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7SUc.woff2) format("woff2");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF}',
  '@font-face{font-family:Inter;font-style:normal;font-weight:300 700;font-display:swap;src:url(fonts/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}',
  '@font-face{font-family:JetBrains Mono;font-style:normal;font-weight:400 500;font-display:swap;src:url(fonts/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx3cwhsk.woff2) format("woff2");unicode-range:U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F}',
  '@font-face{font-family:JetBrains Mono;font-style:normal;font-weight:400 500;font-display:swap;src:url(fonts/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxTcwhsk.woff2) format("woff2");unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}',
  '@font-face{font-family:JetBrains Mono;font-style:normal;font-weight:400 500;font-display:swap;src:url(fonts/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxPcwhsk.woff2) format("woff2");unicode-range:U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF}',
  '@font-face{font-family:JetBrains Mono;font-style:normal;font-weight:400 500;font-display:swap;src:url(fonts/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx_cwhsk.woff2) format("woff2");unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB}',
  '@font-face{font-family:JetBrains Mono;font-style:normal;font-weight:400 500;font-display:swap;src:url(fonts/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx7cwhsk.woff2) format("woff2");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF}',
  '@font-face{font-family:JetBrains Mono;font-style:normal;font-weight:400 500;font-display:swap;src:url(fonts/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}',
].join('');

export function hashContent8(input) {
  return createHash('sha256').update(input).digest('hex').slice(0, 8);
}

export function parseArgs(argv = process.argv.slice(2)) {
  return parseCliFlags(argv, {
    defaults: {
      webviewDist: DEFAULT_WEBVIEW_DIST,
      out: DEFAULT_OUT_DIR,
      scenariosDir: DEFAULT_SCENARIOS_DIR,
      bridgeEntry: DEFAULT_BRIDGE_ENTRY,
    },
    flags: {
      '--webview-dist': (opts, nextVal) => {
        opts.webviewDist = nextVal();
      },
      '--out': (opts, nextVal) => {
        opts.out = nextVal();
      },
      '--scenarios-dir': (opts, nextVal) => {
        opts.scenariosDir = nextVal();
      },
      '--bridge-entry': (opts, nextVal) => {
        opts.bridgeEntry = nextVal();
      },
    },
  });
}

async function copyWebviewRecursive(srcDir, dstDir, depth = 0) {
  if (depth > 16) {
    throw new Error(`Maximum directory recursion depth exceeded at ${srcDir}`);
  }
  const entries = await readdir(srcDir, { withFileTypes: true });
  await mkdir(dstDir, { recursive: true });
  for (const entry of entries) {
    if (entry.name.toLowerCase().endsWith('.map')) continue;
    const srcPath = join(srcDir, entry.name);
    const dstPath = join(dstDir, entry.name);
    if (entry.isSymbolicLink()) {
      let targetStat;
      try {
        targetStat = await stat(srcPath);
      } catch {
        continue;
      }
      if (targetStat.isDirectory()) {
        await copyWebviewRecursive(srcPath, dstPath, depth + 1);
      } else {
        await copyFile(srcPath, dstPath);
      }
    } else if (entry.isDirectory()) {
      await copyWebviewRecursive(srcPath, dstPath, depth + 1);
    } else if (entry.isFile()) {
      await copyFile(srcPath, dstPath);
    }
  }
}

function addFileContentHash(relPath, hash8) {
  const ext = extname(relPath);
  if (!ext) return `${relPath}.${hash8}`;
  return `${relPath.slice(0, -ext.length)}.${hash8}${ext}`;
}

function resolveHashedFontSubpath(normalizedRel, fontMap) {
  if (fontMap && fontMap.has(normalizedRel)) {
    return fontMap.get(normalizedRel);
  }
  const gstaticRoot = resolve(FONTS_SOURCE_DIR, 'gstatic');
  const srcFile = resolve(gstaticRoot, normalizedRel);
  if (
    (srcFile === gstaticRoot || srcFile.startsWith(gstaticRoot + sep)) &&
    existsSync(srcFile)
  ) {
    const hash8 = hashContent8(readFileSync(srcFile));
    const hashed = addFileContentHash(normalizedRel, hash8);
    if (fontMap) fontMap.set(normalizedRel, hashed);
    return hashed;
  }
  return normalizedRel;
}

/**
 * Rewrites Google Fonts links/imports and `https://fonts.gstatic.com/...` or local
 * `fonts/s/...` references in CSS or HTML text.
 *
 * - Collects canonical unhashed font paths (`s/.../*.woff2`) into `referencedFontPaths`.
 * - Rewrites each font reference to `<relFontsPrefix>/<hashedSubpath>`, where
 *   `relFontsPrefix` is computed relative to the CSS/HTML file's directory so CSS
 *   files in subfolders resolve `../fonts/s/...` accurately.
 */
export function rewriteFontsInText(
  text,
  referencedFontPaths,
  options = {},
) {
  const isHtml = Boolean(options === true || options?.isHtml);
  const relFontsPrefix = (options?.relFontsPrefix ?? 'fonts').replace(/\/+$/, '');
  const fontMap = options?.fontMap ?? null;

  let updated = text;
  if (isHtml) {
    updated = updated.replace(GOOGLE_FONT_LINK_RE, '');
  }
  updated = updated.replace(GOOGLEAPIS_IMPORT_RE, () => FALLBACK_GOOGLE_FONTS_CSS);

  const fontRefRe =
    /(?:https?:\/\/fonts\.gstatic\.com\/|(?<=url\(\s*['"]?)(?:\.\/|\.\.\/)*fonts\/)(s\/[^\s)"'<>]+)/gi;

  updated = updated.replace(fontRefRe, (_fullMatch, rawSubpath) => {
    const normalizedRel = rawSubpath.replace(/^\/+/, '');
    if (referencedFontPaths) {
      referencedFontPaths.add(normalizedRel);
    }
    const hashedSubpath = resolveHashedFontSubpath(normalizedRel, fontMap);
    return `${relFontsPrefix}/${hashedSubpath}`;
  });

  return updated;
}

async function copySelfHostedFonts(outDir, referencedFontPaths, fontMap) {
  const gstaticRoot = resolve(FONTS_SOURCE_DIR, 'gstatic');
  if (!existsSync(gstaticRoot)) {
    throw new Error(`Self-hosted font directory missing: ${gstaticRoot}`);
  }
  const copiedFonts = [];
  for (const relPath of [...referencedFontPaths].sort()) {
    const normalizedRel = relPath.replace(/^\/+/, '');
    const srcFile = resolve(gstaticRoot, normalizedRel);
    if (srcFile !== gstaticRoot && !srcFile.startsWith(gstaticRoot + sep)) {
      throw new Error(`Refusing unsafe font path: ${relPath}`);
    }
    if (!existsSync(srcFile)) {
      throw new Error(
        `Missing self-hosted font in ${gstaticRoot} for ${relPath}`,
      );
    }
    const fontBytes = await readFile(srcFile);
    const fontHash = hashContent8(fontBytes);
    const hashedSubpath = addFileContentHash(normalizedRel, fontHash);
    fontMap.set(normalizedRel, hashedSubpath);

    const dstFile = join(outDir, 'fonts', hashedSubpath);
    await mkdir(dirname(dstFile), { recursive: true });
    await writeFile(dstFile, fontBytes);
    copiedFonts.push(`fonts/${hashedSubpath}`);
  }

  // Copy SIL Open Font License files alongside redistributed fonts
  const fontDirEntries = await readdir(FONTS_SOURCE_DIR, {
    withFileTypes: true,
  });
  for (const entry of fontDirEntries) {
    if (
      entry.isFile() &&
      entry.name.startsWith('OFL-') &&
      entry.name.endsWith('.txt')
    ) {
      const dstLicense = join(outDir, 'fonts', entry.name);
      await mkdir(dirname(dstLicense), { recursive: true });
      await copyFile(join(FONTS_SOURCE_DIR, entry.name), dstLicense);
    }
  }
  return copiedFonts;
}

export function buildDemoCsp(inlineScriptHashes) {
  const scriptTokens = ["'self'", ...inlineScriptHashes].join(' ');
  return [
    "default-src 'none'",
    `script-src ${scriptTokens}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

function computeInlineScriptHashes(html) {
  const hashes = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(scriptRe)) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const digest = createHash('sha256').update(body, 'utf8').digest('base64');
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

export function rewriteIndexHtml(
  rawHtml,
  referencedFontPaths,
  options = {},
) {
  if (typeof rawHtml !== 'string' || !/<head\b[^>]*>/i.test(rawHtml)) {
    throw new Error('Expected index.html to contain a <head> element');
  }

  const bridgeFileName = options.bridgeFileName ?? 'replay-bridge.js';
  const scenarioVersion = options.scenarioVersion ?? null;
  const themeExtraFileName = options.themeExtraFileName ?? null;
  const fontMap = options.fontMap ?? null;

  let html = rawHtml
    .replace(/\r\n?/g, '\n')
    .replace(META_TAG_RE, (tag) => (CSP_ATTR_RE.test(tag) ? '' : tag))
    .replace(BRIDGE_SCRIPT_RE, '');

  html = rewriteFontsInText(html, referencedFontPaths, {
    isHtml: true,
    relFontsPrefix: 'fonts',
    fontMap,
  });

  if (themeExtraFileName) {
    html = html.replace(
      /(<link\b[^>]*\bid=["']ptah-theme-extra["'][^>]*\bhref=["'])theme-extra\.css(["'][^>]*>)/i,
      `$1${themeExtraFileName}$2`,
    );
  }

  // Rewrite <base href="..."> to <base href="/demo/">
  if (/<base\b[^>]*>/i.test(html)) {
    html = html.replace(/<base\b[^>]*>/i, '<base href="/demo/">');
  } else {
    html = html.replace(
      /<head(\b[^>]*)>/i,
      '<head$1>\n    <base href="/demo/">',
    );
  }

  const bridgeScriptTag = scenarioVersion
    ? `<script src="${bridgeFileName}" data-scenario-version="${scenarioVersion}"></script>`
    : `<script src="${bridgeFileName}"></script>`;

  // Inject bridge script as the first <script> in <head>
  const headCloseIdx = html.search(/<\/head\s*>/i);
  if (headCloseIdx === -1) {
    throw new Error('Expected index.html to contain a closing </head> tag');
  }
  const headSlice = html.slice(0, headCloseIdx);
  const firstScriptMatch = headSlice.match(/<script\b/i);
  if (firstScriptMatch && firstScriptMatch.index !== undefined) {
    const insertAt = firstScriptMatch.index;
    html =
      html.slice(0, insertAt) +
      `${bridgeScriptTag}\n    ` +
      html.slice(insertAt);
  } else {
    html =
      html.slice(0, headCloseIdx) +
      `  ${bridgeScriptTag}\n  ` +
      html.slice(headCloseIdx);
  }

  // Compute sha256 hashes for every remaining inline <script> after all rewrites
  const inlineHashes = computeInlineScriptHashes(html);
  const csp = buildDemoCsp(inlineHashes);
  const cspMetaTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

  // Insert CSP meta right after <base href="/demo/"> so both base and CSP precede all scripts/links
  html = html.replace(
    '<base href="/demo/">',
    `<base href="/demo/">\n    ${cspMetaTag}`,
  );

  return { html, csp, inlineHashes };
}

/**
 * External URL scanner rule:
 * 1. For `.html` and `.css` files: zero `https://` URLs are allowed, and zero `http://`
 *    URLs are allowed except W3C XML/SVG/XHTML/MathML namespace URIs (`http://www.w3.org/...`).
 * 2. For `.js` files (chunks and replay-bridge): rejects any external font, stylesheet, or
 *    script load:
 *    - Any URL pointing to Google Fonts or known font/script/style CDNs (`fonts.googleapis.com`,
 *      `fonts.gstatic.com`, `use.fontawesome.com`, `ka-f.fontawesome.com`, `cdn.jsdelivr.net`,
 *      `unpkg.com`, `cdnjs.cloudflare.com`, `esm.sh`, `ga.jspm.io`).
 *    - Any `https?://` URL whose path ends in a font, stylesheet, or script extension
 *      (`.woff2`, `.woff`, `.ttf`, `.otf`, `.eot`, `.css`, `.js`, `.mjs`, `.cjs`, `.wasm`).
 *    - Any `https?://` URL inside a CSS `url(...)`, `@import`, `import(...)`, or `importScripts(...)`.
 *    Plain non-loaded strings in JS (such as W3C/JSON-Schema namespace URIs, `<a href target="_blank">`
 *    external doc links, MCP/provider catalog metadata URLs, and library error message URLs) are allowed.
 */
const JS_FORBIDDEN_ASSET_HOST_RE =
  /^https?:\/\/(?:fonts\.(?:googleapis|gstatic)\.com|(?:use|ka-f)\.fontawesome\.com|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|esm\.sh|ga\.jspm\.io)(?:\/|$)/i;
const JS_FORBIDDEN_ASSET_EXT_RE =
  /^https?:\/\/[^\s)"'<>`\\]+?\.(?:woff2?|ttf|otf|eot|css|m?js|cjs|wasm)(?:[?#][^\s)"'<>`\\]*)?$/i;
const JS_FORBIDDEN_LOAD_CONTEXT_RE =
  /(?:@import\s+(?:url\()?|\bimport(?:Scripts)?\s*\(\s*|\burl\(\s*)['"`]https?:\/\/[^\s)"'<>`\\]+/gi;

export function assertNoExternalUrls(filePath, content) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    const badUrls = new Set();
    for (const match of content.matchAll(JS_FORBIDDEN_LOAD_CONTEXT_RE)) {
      badUrls.add(match[0]);
    }
    for (const match of content.matchAll(/https?:\/\/[^\s)"'<>`\\]+/gi)) {
      const url = match[0].replace(/[.,;:]+$/, '');
      if (
        JS_FORBIDDEN_ASSET_HOST_RE.test(url) ||
        JS_FORBIDDEN_ASSET_EXT_RE.test(url)
      ) {
        badUrls.add(url);
      }
    }
    if (badUrls.size > 0) {
      throw new Error(
        `External font/style/script URL(s) remaining in ${filePath}: ${[...badUrls].join(', ')}`,
      );
    }
    return;
  }

  const httpsMatches = [...content.matchAll(/https:\/\/[^\s)"'<>]+/gi)].map(
    (m) => m[0],
  );
  if (httpsMatches.length > 0) {
    throw new Error(
      `External https:// URL(s) remaining in ${filePath}: ${[...new Set(httpsMatches)].join(', ')}`,
    );
  }
  const httpMatches = [...content.matchAll(/http:\/\/[^\s)"'<>]+/gi)]
    .map((m) => m[0])
    .filter((u) => !u.startsWith('http://www.w3.org/'));
  if (httpMatches.length > 0) {
    throw new Error(
      `External http:// URL(s) remaining in ${filePath}: ${[...new Set(httpMatches)].join(', ')}`,
    );
  }
}

async function bundleReplayBridge(bridgeEntry, outDir) {
  const result = await esbuild.build({
    entryPoints: [bridgeEntry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'silent',
    write: false,
  });
  const bridgeBytes = Buffer.from(result.outputFiles[0].contents);
  const bridgeHash = hashContent8(bridgeBytes);
  const bridgeFileName = `replay-bridge.${bridgeHash}.js`;
  await writeFile(join(outDir, bridgeFileName), bridgeBytes);
  return { bridgeFileName, bridgeHash };
}

async function copyScenarios(scenariosDir, outDir) {
  const outScenariosDir = join(outDir, 'scenarios');
  await mkdir(outScenariosDir, { recursive: true });
  const scenarioFiles = [];

  if (existsSync(scenariosDir)) {
    const entries = await readdir(scenariosDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.json') || entry.name === 'index.json') continue;
      const id = entry.name.slice(0, -'.json'.length);
      if (!/^[a-z0-9-]+$/.test(id)) {
        throw new Error(
          `Invalid scenario filename "${entry.name}" in ${scenariosDir}`,
        );
      }
      scenarioFiles.push({ id, name: entry.name });
    }
  }

  scenarioFiles.sort((a, b) => a.id.localeCompare(b.id));
  const versionHasher = createHash('sha256');
  const ids = [];

  for (const item of scenarioFiles) {
    const srcPath = join(scenariosDir, item.name);
    const dstPath = join(outScenariosDir, item.name);
    const rawBytes = await readFile(srcPath);
    await writeFile(dstPath, rawBytes);
    versionHasher.update(`${item.name}\0`, 'utf8');
    versionHasher.update(rawBytes);
    ids.push(item.id);
  }

  const version = versionHasher.digest('hex').slice(0, 8);
  await writeFile(
    join(outScenariosDir, 'index.json'),
    JSON.stringify({ version, ids }, null, 2) + '\n',
    'utf8',
  );
  return { ids, version };
}

async function resolveOrHashThemeExtraCss(outDir) {
  const unhashedPath = join(outDir, 'theme-extra.css');
  if (existsSync(unhashedPath)) {
    const bytes = await readFile(unhashedPath);
    const hash8 = hashContent8(bytes);
    const hashedName = `theme-extra.${hash8}.css`;
    await rename(unhashedPath, join(outDir, hashedName));
    return hashedName;
  }
  const entries = await readdir(outDir, { withFileTypes: true });
  const hashedEntry = entries.find(
    (e) =>
      e.isFile() &&
      /^theme-extra[.-][0-9a-zA-Z_-]+\.css$/i.test(e.name),
  );
  return hashedEntry ? hashedEntry.name : null;
}

async function computeSizeSummary(outDir) {
  const allFiles = await walkFiles(outDir);
  const jsCssFiles = allFiles.filter((f) => /\.(?:js|css)$/i.test(f));
  let raw = 0;
  let gzip = 0;
  let brotli = 0;
  for (const file of jsCssFiles) {
    const bytes = await readFile(file);
    raw += bytes.length;
    gzip += gzipSync(bytes).length;
    brotli += brotliCompressSync(bytes, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
    }).length;
  }
  return {
    totalFiles: allFiles.length,
    jsCssFiles: jsCssFiles.length,
    raw,
    gzip,
    brotli,
  };
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB (${bytes.toLocaleString('en-US')} B)`;
}

export async function buildLiveDemo(rawOptions = {}) {
  const webviewDist = resolve(
    WORKSPACE_ROOT,
    rawOptions.webviewDist ?? DEFAULT_WEBVIEW_DIST,
  );
  const outDir = resolve(WORKSPACE_ROOT, rawOptions.out ?? DEFAULT_OUT_DIR);
  const scenariosDir = resolve(
    WORKSPACE_ROOT,
    rawOptions.scenariosDir ?? DEFAULT_SCENARIOS_DIR,
  );
  const bridgeEntry = resolve(
    WORKSPACE_ROOT,
    rawOptions.bridgeEntry ?? DEFAULT_BRIDGE_ENTRY,
  );

  if (!existsSync(webviewDist) || !existsSync(join(webviewDist, 'index.html'))) {
    throw new Error(
      `Webview build not found at ${webviewDist}. Run ptah-extension-webview:build first.`,
    );
  }
  if (!existsSync(bridgeEntry)) {
    throw new Error(`Replay bridge entry not found at ${bridgeEntry}.`);
  }

  // 1. Clean output directory
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // 2. Copy webview build excluding *.map
  await copyWebviewRecursive(webviewDist, outDir);

  // 3. Rewrite all *.css files with relative font paths + content-hashed font filenames
  const referencedFontPaths = new Set();
  const fontMap = new Map();
  const allCopiedFiles = await walkFiles(outDir);
  const cssFiles = allCopiedFiles.filter(
    (f) => extname(f).toLowerCase() === '.css',
  );
  const fontsOutRoot = join(outDir, 'fonts');

  for (const cssFile of cssFiles) {
    const rawCss = await readFile(cssFile, 'utf8');
    const relFontsPrefix = relative(dirname(cssFile), fontsOutRoot)
      .split(sep)
      .join('/');
    const rewrittenCss = rewriteFontsInText(rawCss, referencedFontPaths, {
      isHtml: false,
      relFontsPrefix,
      fontMap,
    });
    assertNoExternalUrls(relative(outDir, cssFile), rewrittenCss);
    await writeFile(cssFile, rewrittenCss, 'utf8');
  }

  // Ensure deferred theme-extra.css is content-hashed and linked accurately in index.html
  const themeExtraFileName = await resolveOrHashThemeExtraCss(outDir);

  // 4. Bundle the bridge entry into replay-bridge.<hash8>.js
  const { bridgeFileName, bridgeHash } = await bundleReplayBridge(
    bridgeEntry,
    outDir,
  );

  // 5. Copy scenario *.json files and generate scenarios/index.json with { version, ids }
  const { ids: scenarioIds, version: scenarioVersion } = await copyScenarios(
    scenariosDir,
    outDir,
  );

  // 6. Rewrite index.html with <base href="/demo/">, hashed bridge + data-scenario-version, and CSP
  const indexPath = join(outDir, 'index.html');
  const rawIndex = await readFile(indexPath, 'utf8');
  const { html: rewrittenIndex, csp, inlineHashes } = rewriteIndexHtml(
    rawIndex,
    referencedFontPaths,
    {
      bridgeFileName,
      scenarioVersion,
      themeExtraFileName,
      fontMap,
    },
  );
  assertNoExternalUrls('index.html', rewrittenIndex);
  await writeFile(indexPath, rewrittenIndex, 'utf8');

  // 7. Copy referenced self-hosted font files (with content hash) + OFL notices
  const copiedFonts = await copySelfHostedFonts(
    outDir,
    referencedFontPaths,
    fontMap,
  );

  // 8. Scan all JS files in outDir for forbidden external font/style/script URLs
  const postBuildFiles = await walkFiles(outDir);
  const jsFiles = postBuildFiles.filter((f) =>
    /\.(?:m?js|cjs)$/i.test(extname(f)),
  );
  for (const jsFile of jsFiles) {
    const jsContent = await readFile(jsFile, 'utf8');
    assertNoExternalUrls(relative(outDir, jsFile), jsContent);
  }

  // 9. Compute size summary
  const sizes = await computeSizeSummary(outDir);

  console.log(
    `[build-live-demo] Output: ${outDir} (${sizes.totalFiles} files, ${copiedFonts.length} hashed fonts, bridge=${bridgeFileName}, scenarioVersion=${scenarioVersion}, ${scenarioIds.length} scenario(s): ${scenarioIds.join(', ') || 'none'})`,
  );
  console.log(
    `[build-live-demo] JS+CSS (${sizes.jsCssFiles} files): raw=${formatBytes(sizes.raw)} | gzip=${formatBytes(sizes.gzip)} | brotli=${formatBytes(sizes.brotli)}`,
  );

  return {
    outDir,
    csp,
    inlineHashes,
    bridgeFileName,
    bridgeHash,
    themeExtraFileName,
    copiedFonts,
    scenarioIds,
    scenarioVersion,
    sizes,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    await buildLiveDemo(opts);
  } catch (error) {
    console.error(
      `[build-live-demo] ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

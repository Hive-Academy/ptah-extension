import { existsSync, statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';

/**
 * Shared CLI argument parser for scripts/landing/*.mjs.
 * Supports `--flag value` and `--flag=value` forms, plus an optional positional handler.
 */
export function parseCliFlags(argv = process.argv.slice(2), config = {}) {
  const opts = { ...(config.defaults ?? {}) };
  const flags = config.flags ?? {};
  const onPositional = config.onPositional ?? null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eqIdx = arg.indexOf('=');
    const [flag, inlineVal] =
      eqIdx !== -1
        ? [arg.slice(0, eqIdx), arg.slice(eqIdx + 1)]
        : [arg, undefined];

    const nextVal = () => {
      if (inlineVal !== undefined) return inlineVal;
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${flag}`);
      return argv[++i];
    };

    if (Object.prototype.hasOwnProperty.call(flags, flag)) {
      flags[flag](opts, nextVal, arg);
    } else if (onPositional && onPositional(opts, arg)) {
      // handled positional argument
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return opts;
}

export async function walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Verifies the built /demo/ artifact contract on disk (no browser needed):
 * - demo/index.html exists, contains <base href="/demo/"> and CSP <meta>
 * - demo/index.html references replay-bridge.<hash8>.js with data-scenario-version="<hash8>"
 * - the referenced replay-bridge.<hash8>.js exists and is non-empty
 * - demo/scenarios/index.json has { version: "<hash8>", ids: [...] } matching data-scenario-version
 * - every id in demo/scenarios/index.json has a non-empty demo/scenarios/<id>.json file
 * - every font file referenced by demo CSS exists (resolved relative to each CSS file) and is non-empty
 */
export async function verifyDemoArtifacts(rootDir) {
  const resolvedRoot = resolve(rootDir);
  const demoDir = join(resolvedRoot, 'demo');
  const indexHtmlPath = join(demoDir, 'index.html');
  const scenariosIndexPath = join(demoDir, 'scenarios', 'index.json');

  for (const requiredPath of [indexHtmlPath, scenariosIndexPath]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Required PtahCode demo artifact missing: ${requiredPath}`);
    }
  }

  const indexHtml = await readFile(indexHtmlPath, 'utf8');
  if (!indexHtml.includes('<base href="/demo/">')) {
    throw new Error('demo/index.html is missing <base href="/demo/">');
  }
  if (!/http-equiv=["']Content-Security-Policy["']/i.test(indexHtml)) {
    throw new Error('demo/index.html is missing Content-Security-Policy meta tag');
  }

  const bridgeTagMatch = indexHtml.match(
    /<script\b([^>]*\bsrc=["'](replay-bridge\.[0-9a-f]{8}\.js)["'][^>]*)>\s*<\/script\s*>/i,
  );
  if (!bridgeTagMatch) {
    throw new Error(
      'demo/index.html is missing hashed <script src="replay-bridge.<hash8>.js"> tag',
    );
  }
  const bridgeAttrs = bridgeTagMatch[1];
  const bridgeFileName = bridgeTagMatch[2];
  const versionAttrMatch = bridgeAttrs.match(
    /\bdata-scenario-version=["']([0-9a-f]{8})["']/i,
  );
  if (!versionAttrMatch) {
    throw new Error(
      `demo/index.html bridge script (${bridgeFileName}) is missing data-scenario-version="<hash8>"`,
    );
  }
  const htmlScenarioVersion = versionAttrMatch[1];

  const bridgePath = join(demoDir, bridgeFileName);
  if (!existsSync(bridgePath) || statSync(bridgePath).size === 0) {
    throw new Error(
      `Referenced replay bridge file missing or empty: ${bridgePath}`,
    );
  }

  const rawIndex = JSON.parse(await readFile(scenariosIndexPath, 'utf8'));
  if (
    !rawIndex ||
    typeof rawIndex !== 'object' ||
    Array.isArray(rawIndex) ||
    typeof rawIndex.version !== 'string' ||
    !/^[0-9a-f]{8}$/.test(rawIndex.version) ||
    !Array.isArray(rawIndex.ids) ||
    rawIndex.ids.length === 0
  ) {
    throw new Error(
      `Invalid scenarios/index.json format at ${scenariosIndexPath}: expected { "version": "<hash8>", "ids": [...] }`,
    );
  }
  if (rawIndex.version !== htmlScenarioVersion) {
    throw new Error(
      `Scenario version mismatch: index.html has ${htmlScenarioVersion}, scenarios/index.json has ${rawIndex.version}`,
    );
  }

  for (const id of rawIndex.ids) {
    if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) {
      throw new Error(`Invalid scenario id "${String(id)}" in ${scenariosIndexPath}`);
    }
    const scenarioPath = join(demoDir, 'scenarios', `${id}.json`);
    if (!existsSync(scenarioPath) || statSync(scenarioPath).size === 0) {
      throw new Error(`Missing or empty scenario file for id "${id}": ${scenarioPath}`);
    }
  }

  const allDemoFiles = await walkFiles(demoDir);
  const cssFiles = allDemoFiles.filter(
    (f) => extname(f).toLowerCase() === '.css',
  );
  const verifiedFonts = new Set();
  const fontUrlRe =
    /\burl\(\s*['"]?([^)'"\s]+?\.(?:woff2?|ttf|otf))(?:\?[^)'"\s]*)?['"]?\s*\)/gi;

  for (const cssFile of cssFiles) {
    const cssText = await readFile(cssFile, 'utf8');
    for (const match of cssText.matchAll(fontUrlRe)) {
      const refUrl = match[1];
      if (/^(?:data:|https?:)/i.test(refUrl)) {
        throw new Error(`Non-local font URL "${refUrl}" in ${cssFile}`);
      }
      const resolvedFont = refUrl.startsWith('/demo/')
        ? resolve(demoDir, refUrl.slice('/demo/'.length))
        : resolve(dirname(cssFile), refUrl);
      if (
        resolvedFont !== demoDir &&
        !resolvedFont.startsWith(demoDir + sep)
      ) {
        throw new Error(
          `Font URL "${refUrl}" in ${cssFile} escapes demo directory`,
        );
      }
      if (!existsSync(resolvedFont) || statSync(resolvedFont).size === 0) {
        throw new Error(
          `Missing or empty font file referenced by ${cssFile}: ${refUrl} -> ${resolvedFont}`,
        );
      }
      verifiedFonts.add(resolvedFont);
    }
  }

  if (verifiedFonts.size === 0) {
    throw new Error(`No self-hosted font references found in ${demoDir}/*.css`);
  }

  return {
    bridgeFileName,
    scenarioVersion: rawIndex.version,
    scenarioIds: rawIndex.ids,
    verifiedFontCount: verifiedFonts.size,
  };
}

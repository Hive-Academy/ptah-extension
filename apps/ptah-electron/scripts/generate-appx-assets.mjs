#!/usr/bin/env node
/**
 * Generates the Microsoft Store (appx) tile PNGs from the app icon.
 *
 * Source: apps/ptah-electron/src/assets/icons/icon.png
 * Output: apps/ptah-electron/src/assets/appx/{StoreLogo,Square44x44Logo,
 *         Square150x150Logo,Wide310x150Logo}.png (committed; electron-builder
 *         reads them via buildResources/appx).
 *
 * Run once, and again whenever the icon changes:
 *   node apps/ptah-electron/scripts/generate-appx-assets.mjs
 *
 * `sharp` is a transitive dependency resolved from the repo root.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', 'src', 'assets', 'icons', 'icon.png');
const outDir = join(here, '..', 'src', 'assets', 'appx');
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** Square tile: icon contained in the canvas with ~12% transparent padding. */
async function squareTile(name, size) {
  const inner = Math.round(size * 0.76);
  const pad = Math.floor((size - inner) / 2);
  const icon = await sharp(source)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: TRANSPARENT },
  })
    .composite([{ input: icon, left: pad, top: pad }])
    .png()
    .toFile(join(outDir, name));
}

/** Wide tile: 120 px high icon centred on a transparent 310x150 canvas. */
async function wideTile(name) {
  const width = 310;
  const height = 150;
  const iconSize = 120;
  const icon = await sharp(source)
    .resize(iconSize, iconSize, { fit: 'contain', background: TRANSPARENT })
    .toBuffer();
  await sharp({
    create: { width, height, channels: 4, background: TRANSPARENT },
  })
    .composite([
      {
        input: icon,
        left: Math.floor((width - iconSize) / 2),
        top: Math.floor((height - iconSize) / 2),
      },
    ])
    .png()
    .toFile(join(outDir, name));
}

mkdirSync(outDir, { recursive: true });
await squareTile('StoreLogo.png', 50);
await squareTile('Square44x44Logo.png', 44);
await squareTile('Square150x150Logo.png', 150);
await wideTile('Wide310x150Logo.png');
console.log(`Wrote Store tiles to ${outDir}`);

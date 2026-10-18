/**
 * Pixel compare of the six existing role rows, BEFORE vs AFTER (Req 1.7).
 * Usage: node compare-rows.cjs <beforeDir> <afterDir>
 * Region compared: the six cards (x 300..1012, y 122..335 in the 1100x700 window shots, summary scrolled to top),
 * so the summary text/badge ("6 roles" -> "7 roles", added word "decision") and the area below the cards are excluded.
 */
const path = require('path');
const sharp = require(path.resolve('D:/projects/ptah-extension/node_modules/sharp'));
const [beforeDir, afterDir] = [process.argv[2], process.argv[3]];
const region = { left: 300, top: 122, width: 712, height: 214 };
const regionOpen = { left: 300, top: 122, width: 712, height: 83 }; // top card row (the opened Synthesis card is in it)
const regionPopover = { left: 560, top: 215, width: 420, height: 275 }; // inside the Synthesis popover body

async function diff(a, b, r) {
  const A = await sharp(a).extract(r).raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(b).extract(r).raw().toBuffer({ resolveWithObject: true });
  let n = 0, max = 0;
  const ch = A.info.channels;
  for (let i = 0; i < A.data.length; i += ch) {
    const d = Math.max(...[0, 1, 2].map((k) => Math.abs(A.data[i + k] - B.data[i + k])));
    if (d > 0) n++;
    if (d > max) max = d;
  }
  return { differingPixels: n, totalPixels: A.info.width * A.info.height, maxChannelDelta: max };
}

(async () => {
  for (const theme of ['dark', 'light']) {
    for (const [state, r] of [['roles-viewport', region], ['roles-row-open', regionOpen], ['roles-row-open', regionPopover]]) {
      const res = await diff(path.join(beforeDir, `before-${state}-${theme}.png`), path.join(afterDir, `after-${state}-${theme}.png`), r);
      console.log(theme, state, JSON.stringify(r), JSON.stringify(res));
    }
  }
})();

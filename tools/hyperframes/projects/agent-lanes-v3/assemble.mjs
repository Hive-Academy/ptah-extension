// Assemble index.html from src/index.tpl (a template, not an .html file, so Studio and lint do not treat it as a composition) + one fragment per storyboard frame (compositions/frames/NN-*.html).
//   node assemble.mjs
//
// Why fragments and not sub-compositions: the HyperFrames bundler gives duplicate kit mounts unique
// runtime ids only when they are top-level hosts of index.html. Mounts nested inside a sub-composition
// get no scope, so every instance of a kit component resolves the same #root and collapses onto it.
// A fragment keeps one scene per file, and its kit mounts land at the top level after assembly.
//
// Fragment shape (inside <template>):
//   <style>  frame CSS, ids prefixed with the frame id
//   <div id="fNN" class="scene" data-frame-start="S" data-frame-duration="D">  markup; data-start is frame-local
//   <script> body runs as (function (tl, T0) { ... }) on the main timeline; positions are T0 + local
import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const framesDir = join(here, "compositions", "frames");
const round = (n) => Math.round(n * 1000) / 1000;

// Kit components are derived files (gitignored): copy the latest build from the kit.
const kitOut = join(here, "..", "..", "kits", "ptah-ui", "components");
if (!existsSync(kitOut)) throw new Error("kit not built: run node build.mjs in tools/hyperframes/kits/ptah-ui");
const compDir = join(here, "compositions", "components");
mkdirSync(compDir, { recursive: true });
for (const f of readdirSync(kitOut).filter((n) => n.endsWith(".html"))) copyFileSync(join(kitOut, f), join(compDir, "ptah-ui-" + f));

const frames = readdirSync(framesDir)
  .filter((f) => /^\d\d-.+\.html$/.test(f))
  .sort()
  .map((file) => {
    const src = readFileSync(join(framesDir, file), "utf8");
    const tpl = src.match(/<template>([\s\S]*)<\/template>/);
    if (!tpl) throw new Error(`${file}: no <template>`);
    const body = tpl[1];
    const css = [...body.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
    const js = [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
    const markup = body.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<script>[\s\S]*?<\/script>/g, "").trim();
    // The fragment root carries composition attributes only so lint accepts the file under compositions/.
    // In index.html it is a plain .scene div, so they are removed there.
    // Studio may add attributes (data-hf-id) to the root, so attributes are read in any order.
    const rootRe = /<div(\s[^>]*\bclass="scene"[^>]*)>/;
    const head = markup.match(rootRe);
    const attr = (name) => (head && head[1].match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];
    const id = attr("id");
    const s = attr("data-frame-start");
    const d = attr("data-frame-duration");
    if (!head || !/^f\d\d$/.test(id || "") || s == null || d == null || attr("data-composition-id") !== id) {
      throw new Error(`${file}: root must be <div id="fNN" class="scene" data-composition-id="fNN" data-width="1920" data-height="1080" data-frame-start data-frame-duration>`);
    }
    const t0 = Number(s);
    const kept = head[1].replace(/\s(data-composition-id|data-width|data-height|data-frame-start|data-frame-duration)="[^"]*"/g, "");
    const html = markup
      .replace(rootRe, `<div${kept}>`)
      .replace(/data-start="([\d.]+)"/g, (_, v) => `data-start="${round(Number(v) + t0)}"`);
    return { file, id, t0, dur: Number(d), css, js, html };
  });

for (let i = 1; i < frames.length; i++) {
  const prev = frames[i - 1];
  if (Math.abs(prev.t0 + prev.dur - frames[i].t0) > 0.002) throw new Error(`${frames[i].file}: starts at ${frames[i].t0}, previous frame ends at ${round(prev.t0 + prev.dur)}`);
}
const last = frames[frames.length - 1];
const duration = round(last.t0 + last.dur);

let out = readFileSync(join(here, "src", "index.tpl"), "utf8");
out = out
  .replace("/*@frames-css*/", frames.map((f) => `/* ${f.file} */\n${f.css}`).join("\n"))
  .replace("<!--@frames-->", frames.map((f) => `<!-- ${f.file} (${f.t0}-${round(f.t0 + f.dur)}) -->\n${f.html}`).join("\n\n"))
  .replace("/*@scenes*/", frames.map((f) => JSON.stringify(f.id)).join(", "))
  .replace("/*@frames-js*/", frames.map((f) => `// ${f.file}\n(function (tl, T0) {${f.js}})(tl, ${f.t0});`).join("\n"))
  .replaceAll("@DURATION", String(duration));

writeFileSync(join(here, "index.html"), out);
console.log(`assembled ${frames.length} frame(s), ${duration}s: ${frames.map((f) => f.id).join(" ")}`);

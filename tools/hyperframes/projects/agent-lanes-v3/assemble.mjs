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
    // data-seam-in="<shader> <seconds>" names the transition INTO this frame ("cut" = hard cut).
    const seam = (attr("data-seam-in") || "").trim().split(/\s+/);
    const kept = head[1].replace(/\s(data-composition-id|data-width|data-height|data-frame-start|data-frame-duration|data-seam-in)="[^"]*"/g, "");
    return { file, id, t0, dur: Number(d), css, js, markup: markup.replace(rootRe, `<div${kept}>`), seam: { shader: seam[0] || "", dur: Number(seam[1] || 0) } };
  });

for (let i = 1; i < frames.length; i++) {
  const prev = frames[i - 1];
  if (Math.abs(prev.t0 + prev.dur - frames[i].t0) > 0.002) throw new Error(`${frames[i].file}: starts at ${frames[i].t0}, previous frame ends at ${round(prev.t0 + prev.dur)}`);
  if (!frames[i].seam.shader) throw new Error(`${frames[i].file}: missing data-seam-in="<shader> <seconds>" (or "cut")`);
}

// Seams are centered on the cut. HyperShader needs scenes.length === transitions.length + 1, so a hard cut
// is a near-instant crossfade. The outgoing frame's mounts that run to the cut are extended by half a seam,
// so the outgoing scene stays live while the transition shows it.
const transitions = frames.slice(1).map((f) => {
  if (f.seam.shader === "cut") return { time: f.t0, duration: 0.001 };
  return { time: round(f.t0 - f.seam.dur / 2), shader: f.seam.shader, duration: f.seam.dur };
});
for (const [i, f] of frames.entries()) {
  const pad = i + 1 < frames.length && frames[i + 1].seam.shader !== "cut" ? frames[i + 1].seam.dur / 2 : 0;
  f.html = f.markup.replace(/data-start="([\d.]+)"(\s+)data-duration="([\d.]+)"/g, (_, st, sp, du) => {
    const end = Number(st) + Number(du);
    const extra = pad && Math.abs(end - f.dur) < 0.01 ? pad : 0;
    return `data-start="${round(Number(st) + f.t0)}"${sp}data-duration="${round(Number(du) + extra)}"`;
  });
  if (/data-start="/.test(f.html.replace(/data-start="[\d.]+"\s+data-duration=/g, ""))) throw new Error(`${f.file}: every data-start must be followed by data-duration`);
}
const last = frames[frames.length - 1];
const duration = round(last.t0 + last.dur);

let out = readFileSync(join(here, "src", "index.tpl"), "utf8");
out = out
  .replace("/*@frames-css*/", frames.map((f) => `/* ${f.file} */\n${f.css}`).join("\n"))
  .replace("<!--@frames-->", frames.map((f) => `<!-- ${f.file} (${f.t0}-${round(f.t0 + f.dur)}) -->\n${f.html}`).join("\n\n"))
  .replace("/*@scenes*/", frames.map((f) => JSON.stringify(f.id)).join(", "))
  .replace("/*@transitions*/", transitions.map((t) => JSON.stringify(t)).join(",\n          "))
  .replace("/*@frames-js*/", frames.map((f) => `// ${f.file}\n(function (tl, T0) {${f.js}})(tl, ${f.t0});`).join("\n"))
  .replaceAll("@FADE_START", String(round(duration - 1.791)))
  .replaceAll("@DURATION", String(duration));

writeFileSync(join(here, "index.html"), out);
console.log(`assembled ${frames.length} frame(s), ${duration}s: ${frames.map((f) => f.id).join(" ")}`);
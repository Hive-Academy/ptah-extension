// Build the ptah-ui kit: inline shared partials into each component and publish to the gallery.
//   node build.mjs            -> src/*.html -> components/*.html (+ gallery/compositions/ptah-ui/)
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "src");
const out = join(here, "components");
const gallery = join(here, "gallery", "compositions", "components");
const partials = {
  "base.css": readFileSync(join(src, "partials", "base.css"), "utf8"),
  "runtime.js": readFileSync(join(src, "partials", "runtime.js"), "utf8"),
};

mkdirSync(out, { recursive: true });
if (existsSync(join(here, "gallery"))) mkdirSync(gallery, { recursive: true });

const built = [];
for (const file of readdirSync(src).filter((f) => f.endsWith(".html"))) {
  let html = readFileSync(join(src, file), "utf8");
  for (const [name, body] of Object.entries(partials)) {
    html = html.split(`/*@include ${name}*/`).join(body);
  }
  const left = html.match(/\/\*@include [^*]+\*\//);
  if (left) throw new Error(`${file}: unknown include ${left[0]}`);
  writeFileSync(join(out, file), html);
  if (existsSync(gallery)) writeFileSync(join(gallery, "ptah-ui-" + file), html);
  built.push(file);
}
console.log(`built ${built.length}: ${built.join(", ")}`);

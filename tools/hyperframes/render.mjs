// Render a HyperFrames project into <main checkout>/video-output/<project>/<name>.mp4.
//
// Finished videos never live next to source: tools/ holds source only, and a worktree
// removal or `npm run clean` (rm -rf dist) must not delete a render. The main checkout
// is found through git, so this works from any worktree.
//
//   node tools/hyperframes/render.mjs <project-dir> <name> [--4k] [--draft] [-- <extra hyperframes render args>]
//   node tools/hyperframes/render.mjs tools/hyperframes/kits/ptah-ui/gallery ptah-ui-gallery --4k
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const own = sep === -1 ? argv : argv.slice(0, sep);
const extra = sep === -1 ? [] : argv.slice(sep + 1);
const [projectArg, nameArg] = own.filter((a) => !a.startsWith("--"));
if (!projectArg || !nameArg) {
  console.error("usage: node tools/hyperframes/render.mjs <project-dir> <name> [--4k] [--draft] [-- <extra args>]");
  process.exit(2);
}

const projectDir = resolve(projectArg);
const commonDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: projectDir, encoding: "utf8" }).trim();
const mainRoot = dirname(commonDir);
// Output folder name: the project path under tools/hyperframes without the kits/ or projects/ prefix
// (kits/ptah-ui/gallery -> ptah-ui-gallery, projects/agent-lanes-v2 -> agent-lanes-v2).
const rel = relative(dirname(fileURLToPath(import.meta.url)), projectDir).split("\\").join("/");
const slug = rel.startsWith("..") ? basename(projectDir) : rel.replace(/^(kits|projects)\//, "").split("/").join("-");
const outDir = join(mainRoot, "video-output", slug);
mkdirSync(outDir, { recursive: true });
const output = join(outDir, `${nameArg}${own.includes("--4k") ? "-4k" : ""}.mp4`);

const args = ["hyperframes", "render", "--quality", own.includes("--draft") ? "draft" : "delivery", "--output", output];
if (own.includes("--4k")) args.push("--resolution", "4k");
args.push(...extra);

console.log(`render ${projectDir}\n    -> ${output}`);
// shell: true so Windows resolves npx.cmd (Git Bash cannot spawn it directly).
const run = spawnSync("npx", args, { cwd: projectDir, stdio: "inherit", shell: true });
process.exit(run.status ?? 1);

// Render a HyperFrames project into <main checkout>/video-output/<project>/<name>.mp4.
//
// Finished videos never live next to source: tools/ holds source only, and a worktree
// removal or `npm run clean` (rm -rf dist) must not delete a render. The main checkout
// is found through the .git metadata, so this works from any worktree.
//
//   node tools/hyperframes/render.mjs <project-dir> <name> [--4k] [--draft] [-- <extra hyperframes render args>]
//   node tools/hyperframes/render.mjs tools/hyperframes/kits/ptah-ui/gallery ptah-ui-gallery --4k
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
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
// The name becomes a file name under video-output/<project>/; keep it to one plain segment.
if (!/^[\w.-]+$/.test(nameArg) || nameArg.startsWith(".")) {
  console.error(`invalid <name> "${nameArg}": use letters, digits, '.', '_' or '-'`);
  process.exit(2);
}

// Git common dir (the main checkout's .git), read from disk instead of spawning git:
// a worktree's .git is a file "gitdir: <dir>", and <dir>/commondir points at the shared .git.
function gitCommonDir(start) {
  for (let dir = start; ; dir = dirname(dir)) {
    const dotGit = join(dir, ".git");
    if (existsSync(dotGit)) {
      if (statSync(dotGit).isDirectory()) return dotGit;
      const gitDir = resolve(dir, readFileSync(dotGit, "utf8").replace(/^gitdir:\s*/, "").trim());
      const commonFile = join(gitDir, "commondir");
      return existsSync(commonFile) ? resolve(gitDir, readFileSync(commonFile, "utf8").trim()) : gitDir;
    }
    if (dirname(dir) === dir) throw new Error(`not inside a git checkout: ${start}`);
  }
}

// npm's npx entry point, next to the running node binary. Running it with process.execPath
// avoids both a shell (no argument re-parsing) and a PATH lookup, on Windows and Unix alike.
function npxCli() {
  const bin = dirname(process.execPath);
  const candidates = [
    join(bin, "node_modules", "npm", "bin", "npx-cli.js"), // Windows installer layout
    join(bin, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"), // Unix prefix layout
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`npx-cli.js not found next to ${process.execPath}`);
  return found;
}

const projectDir = resolve(projectArg);
const mainRoot = dirname(gitCommonDir(projectDir));
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
const run = spawnSync(process.execPath, [npxCli(), ...args], { cwd: projectDir, stdio: "inherit" });
if (run.error) console.error(run.error.message);
process.exit(run.status ?? 1);

import * as fs from 'fs';
import * as path from 'path';

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'nx.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the Nx workspace root from ' + __dirname);
}

const REPO_ROOT = findRepoRoot();
const PLUGINS_ROOT = 'apps/ptah-extension-vscode/assets/plugins';
const MAX_DESCRIPTION_CHARS = 400;
const MAX_QUOTED_PHRASES = 4;

interface SkillDescription {
  file: string;
  raw: string | null;
  value: string;
}

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function skillFiles(): string[] {
  const root = path.join(REPO_ROOT, PLUGINS_ROOT);
  return listDirs(root).flatMap((plugin) => {
    const skillsDir = path.join(root, plugin, 'skills');
    return listDirs(skillsDir)
      .map((slug) => path.join(skillsDir, slug, 'SKILL.md'))
      .filter((file) => fs.existsSync(file))
      .map((file) => path.relative(REPO_ROOT, file).split(path.sep).join('/'));
  });
}

function unquote(raw: string): string {
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"');
  }
  return raw;
}

function readDescription(file: string): SkillDescription {
  const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const line = frontmatter?.[1].match(/^description:[ \t]*(.*)$/m);
  if (!line) return { file, raw: null, value: '' };
  const raw = line[1].trim();
  return { file, raw, value: unquote(raw) };
}

function descriptions(): SkillDescription[] {
  return skillFiles().map(readDescription);
}

describe('shipped skill descriptions stay short trigger text', () => {
  it('scans every plugin that ships skills', () => {
    const files = skillFiles();
    expect(files.length).toBeGreaterThanOrEqual(20);
    for (const plugin of ['ptah-core', 'ptah-nx-saas', 'ptah-react']) {
      expect(
        files.some((f) => f.startsWith(`${PLUGINS_ROOT}/${plugin}/`)),
      ).toBe(true);
    }
  });

  it('every skill has a non-empty description', () => {
    const offenders = descriptions()
      .filter((d) => d.value.trim().length === 0)
      .map((d) => d.file);
    expect(offenders).toEqual([]);
  });

  it('every description is a single-line scalar, not a block scalar', () => {
    const offenders = descriptions()
      .filter((d) => d.raw !== null && /^[>|]/.test(d.raw))
      .map((d) => d.file);
    expect(offenders).toEqual([]);
  });

  it(`no description exceeds ${MAX_DESCRIPTION_CHARS} characters`, () => {
    const offenders = descriptions()
      .filter((d) => d.value.length > MAX_DESCRIPTION_CHARS)
      .map((d) => `${d.file} (${d.value.length})`);
    expect(offenders).toEqual([]);
  });

  it('no description carries a numbered list', () => {
    const offenders = descriptions()
      .filter((d) => /\(\d+\)/.test(d.value))
      .map((d) => d.file);
    expect(offenders).toEqual([]);
  });

  it(`no description quotes more than ${MAX_QUOTED_PHRASES} trigger phrases`, () => {
    const offenders = descriptions()
      .map((d) => ({
        file: d.file,
        count: (d.value.match(/"[^"]*"/g) ?? []).length,
      }))
      .filter(({ count }) => count > MAX_QUOTED_PHRASES)
      .map(({ file, count }) => `${file} (${count})`);
    expect(offenders).toEqual([]);
  });
});

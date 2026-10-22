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

function skillFile(plugin: string, slug: string): string {
  return `${PLUGINS_ROOT}/${plugin}/skills/${slug}/SKILL.md`;
}

function descriptionOf(plugin: string, slug: string): SkillDescription {
  return readDescription(skillFile(plugin, slug));
}

function skillText(plugin: string, slug: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, skillFile(plugin, slug)), 'utf8');
}

function skillName(text: string): string {
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const line = frontmatter?.[1].match(/^name:[ \t]*(.*)$/m);
  return line ? unquote(line[1].trim()) : '';
}

function atxHeadings(text: string): string[] {
  return [...text.matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*$/gm)].map((match) =>
    match[1].trim(),
  );
}

function normaliseHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when the description tells the reader not to apply that sibling. */
function rejectsSibling(value: string, sibling: string): boolean {
  const pattern = new RegExp(
    `(?:not for|must not|do not load|do not use|never load|never use)[^.]{0,48}\\b${sibling}\\b|\\b${sibling}\\b[^.]{0,48}(?:must not apply|do not apply)`,
    'i',
  );
  return pattern.test(value);
}

describe('revised skill descriptions keep their static routing contract', () => {
  // Phrase presence only. These cases do not score the routing matrix and
  // do not claim a skill was loaded. Retained description bytes stay unpinned.
  const edited: { plugin: string; slug: string }[] = [
    { plugin: 'ptah-angular', slug: 'angular-frontend-patterns' },
    { plugin: 'ptah-angular', slug: 'angular-3d-scene-crafter' },
    { plugin: 'ptah-angular', slug: 'angular-gsap-animation-crafter' },
    { plugin: 'ptah-core', slug: 'agent-lanes' },
    { plugin: 'ptah-core', slug: 'ddd-architecture' },
    { plugin: 'ptah-core', slug: 'ptah-cli-usage' },
    { plugin: 'ptah-core', slug: 'ptah-surface-authoring' },
    { plugin: 'ptah-nx-saas', slug: 'resilient-nestjs-patterns' },
  ];

  it('every shipped skill name equals its directory', () => {
    const offenders = skillFiles().flatMap((file) => {
      const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      const slug = file.split('/').at(-2);
      const name = skillName(text);
      return name === slug ? [] : [`${file} (name ${name || 'missing'})`];
    });
    expect(offenders).toEqual([]);
  });

  it('the eight revised skills are the ones this contract names', () => {
    const files = skillFiles();
    for (const { plugin, slug } of edited) {
      expect(files).toContain(skillFile(plugin, slug));
    }
  });

  it('angular descriptions name siblings without excluding animation or mandating a scene skill', () => {
    const frontend = descriptionOf('ptah-angular', 'angular-frontend-patterns').value;
    expect(frontend).toContain('Use when building Angular components');
    expect(frontend).toContain('signal state');
    expect(frontend).toContain('angular-3d-scene-crafter');
    expect(frontend).toContain('angular-gsap-animation-crafter');
    expect(frontend).toContain(
      'compatible siblings for scene construction and scroll motion',
    );
    expect(frontend).toContain('composition-patterns');
    expect(frontend).toContain('react-best-practices');
    expect(frontend).not.toMatch(/not for animation/i);
    expect(frontend).not.toMatch(/exclude animation/i);

    const scene = descriptionOf('ptah-angular', 'angular-3d-scene-crafter').value;
    expect(scene).toContain('Designs Angular 3D scenes');
    expect(scene).toContain('animation tuning');
    expect(scene).toContain(
      'angular-gsap-animation-crafter for scroll-timeline page motion when the task has both',
    );
    // Component structure is conditional support, not a load for every scene.
    expect(scene).toContain('angular-frontend-patterns for component structure');
    expect(scene).not.toMatch(/always load angular-frontend-patterns/i);
    expect(scene).not.toMatch(/angular-frontend-patterns for every/i);
    expect(scene).toContain('Non-Angular 3D work is outside this skill');
    expect(scene).not.toMatch(/not for animation/i);

    const motion = descriptionOf(
      'ptah-angular',
      'angular-gsap-animation-crafter',
    ).value;
    expect(motion).toContain('scroll, parallax and timeline');
    expect(motion).toContain('angular-3d-scene-crafter');
    expect(motion).toContain('may load when the task has both');
    expect(motion).toContain(
      'Component structure may load angular-frontend-patterns',
    );
    expect(motion).toContain('Non-Angular animation is outside this skill');
    expect(motion).not.toMatch(/do not load angular-3d-scene-crafter/i);
  });

  it('agent-lanes keeps the spawn mechanic without rejecting workflow or panel skills', () => {
    const lanes = descriptionOf('ptah-core', 'agent-lanes').value;
    expect(lanes).toContain('spawns or resumes a lane');
    expect(lanes).toContain('even if it never names a tool');
    expect(lanes).toContain('ptah_agent_spawn');
    expect(lanes).toContain(
      'the mechanic orchestration and tribunal load for lane work',
    );
    expect(lanes).toContain('not a substitute for the engineering workflow');
    expect(lanes).toContain('multi-vendor panel');
    expect(rejectsSibling(lanes, 'orchestration')).toBe(false);
    expect(rejectsSibling(lanes, 'tribunal')).toBe(false);
  });

  it('nest, domain and surface descriptions assign a primary subject and still allow the sibling', () => {
    const resilient = descriptionOf(
      'ptah-nx-saas',
      'resilient-nestjs-patterns',
    ).value;
    expect(resilient).toContain('retries or fallbacks');
    expect(resilient).toContain('dynamic modules');
    expect(resilient).toContain('nestjs-backend-patterns');
    expect(resilient).toContain('webhook-architecture');
    expect(resilient).toContain('may load both skills');
    expect(rejectsSibling(resilient, 'nestjs-backend-patterns')).toBe(false);
    expect(rejectsSibling(resilient, 'webhook-architecture')).toBe(false);

    const domain = descriptionOf('ptah-core', 'ddd-architecture').value;
    expect(domain).toContain('bounded contexts');
    expect(domain).toContain('aggregates');
    expect(domain).toContain(
      '.NET project and solution layout is dotnet-solution-architect',
    );
    expect(domain).not.toMatch(/nestjs/i);

    const surface = descriptionOf('ptah-core', 'ptah-surface-authoring').value;
    expect(surface.indexOf('Authors ptah-ui blocks')).toBeGreaterThanOrEqual(0);
    expect(surface.indexOf('Authors ptah-ui blocks')).toBeLessThan(
      surface.indexOf('Use for'),
    );
    expect(surface).toContain(
      'turn summary, stats, file changes, test results, a chart, usage or plan limits',
    );
    expect(surface).toContain('technical-content-writer');
    expect(surface).toContain('ui-ux-designer');
    expect(surface).toContain('may still apply');
  });

  it('ptah-cli-usage keeps a headless trigger and the operating facts in the body', () => {
    const cli = descriptionOf('ptah-core', 'ptah-cli-usage').value;
    expect(cli).toMatch(/headless/i);
    expect(cli).toMatch(/\bCI\b/);
    expect(cli).toContain('no clickable UI');
    expect(cli).not.toMatch(/mention/i);

    const text = skillText('ptah-core', 'ptah-cli-usage');
    const headings = atxHeadings(text).map(normaliseHeading);
    expect(headings).not.toContain('when to use this skill');
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    expect(body).toContain('session ends when stdin closes');
    expect(body).toContain(
      '## Hard rule: NDJSON on stdout, human text on stderr',
    );
    const commandMap =
      text.split('### Top-level command map')[1]?.split(/^## /m)[0] ?? '';
    expect(commandMap).toMatch(/^\| Command\b/m);
    expect(commandMap).toContain('`init`');
    expect(commandMap).toContain('`session`');
  });

  it('session-handoff stays limited to the /session-handoff command', () => {
    const handoff = descriptionOf('ptah-core', 'session-handoff').value;
    const gateAt = handoff.toLowerCase().indexOf('use only when');
    expect(gateAt).toBeGreaterThanOrEqual(0);
    expect(handoff.slice(gateAt)).toContain('/session-handoff');
  });
});

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
const SKILLS_ROOT =
  'apps/ptah-extension-vscode/assets/plugins/ptah-core/skills';
const HOME = `${SKILLS_ROOT}/agent-lanes/SKILL.md`;
const SCANNED_SKILLS = ['agent-lanes', 'orchestration', 'tribunal'] as const;

const LANE_RULES: ReadonlyArray<{ rule: string; pattern: RegExp }> = [
  { rule: 'resume parameter', pattern: /resume_session_id/ },
  { rule: 'resume signal', pattern: /CLI Session ID/ },
  {
    rule: 'default concurrency',
    pattern:
      /\b(?:max(?:imum)?|default|at most)\s+\**3\**\s+(?:concurrent|lanes|CLI)/i,
  },
  { rule: 'revise cap', pattern: /\b(?:2|two)\s+revise\s+rounds\b/i },
  {
    rule: 'ptahCliId precedence',
    pattern: /`cli` is ignored|precedence over `cli`/i,
  },
  {
    rule: 'pasted ptah_agent_list row',
    pattern:
      /^\s*\|[^|]*\|\s*`?(?:cli|ptah-cli)`?\s*\|\s*`?(?:not installed|installed|available|disabled)/im,
  },
];

function walkMarkdown(dir: string): string[] {
  const found: string[] = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkMarkdown(full));
    else if (entry.name.endsWith('.md')) {
      found.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
    }
  }
  return found;
}

function scannedFiles(): string[] {
  return SCANNED_SKILLS.flatMap((skill) =>
    walkMarkdown(path.join(REPO_ROOT, SKILLS_ROOT, skill)),
  );
}

function read(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

describe('lane rules have one home in the agent-lanes skill', () => {
  it('scanned every workflow skill that runs lanes', () => {
    const files = scannedFiles();
    for (const skill of SCANNED_SKILLS) {
      expect(files.some((f) => f.startsWith(`${SKILLS_ROOT}/${skill}/`))).toBe(
        true,
      );
    }
  });

  it.each(LANE_RULES)('the home still teaches the $rule', ({ pattern }) => {
    expect(read(HOME)).toMatch(pattern);
  });

  it.each(LANE_RULES)(
    'no other skill file restates the $rule',
    ({ pattern }) => {
      const offenders = scannedFiles().filter(
        (file) => file !== HOME && pattern.test(read(file)),
      );
      expect(offenders).toEqual([]);
    },
  );
});

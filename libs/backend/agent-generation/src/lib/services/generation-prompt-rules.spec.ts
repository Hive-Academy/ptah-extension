import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  GENERATION_RUBRIC_RULES,
  formatRubricRulesBlock,
} from './generation-prompt-rules';

/**
 * Two-sided agreement between the prompt-authoring rubric and the generation
 * prompt rules.
 *
 * The table below is written by hand and imports nothing from the rules
 * module. A rubric edit changes a body hash; a prompt edit changes an
 * instruction hash. Either one alone fails here, so changing either side
 * needs a reviewed edit of this table in the same change.
 *
 * Body hash: sha256 of the text between the rule's heading and the next
 * `## ` heading, with every whitespace run collapsed to one space and trimmed.
 * Instruction hash: sha256 of the module instruction as written.
 */
const PINNED_RUBRIC_RULES: ReadonlyArray<{
  rule: number;
  title: string;
  bodySha256: string;
  instructionSha256: string;
}> = [
  {
    rule: 2,
    title: 'One home per rule',
    bodySha256:
      '7a7921c51a5e939efdeb5a00c99650da97aec790056840714252a6a5ded51cab',
    instructionSha256:
      '3c3bf636520214c53265a951f24e68a1e316211181a23c99fdaf62d6e5b0d184',
  },
  {
    rule: 3,
    title: 'Cut model education',
    bodySha256:
      '342e35f5769918de1b41e9c00ee8a3a275ff5e1151da74763ba8790f4a8cff50',
    instructionSha256:
      'edf858328a76394b5f85d3e2f954a5f937c3b5325afac5213f5b30a9c7569257',
  },
  {
    rule: 5,
    title: 'No history',
    bodySha256:
      '22c846327788d012267ea44193730292daa01851f47eee1f00339acd3ffc423c',
    instructionSha256:
      '1d0c51aa7cde938ca7a573d967b8d48e7968a7b85f5f94e02487874cfc652194',
  },
  {
    rule: 6,
    title: 'Contracts over narrative',
    bodySha256:
      '066900b7a8581382c0ecd3f32cb7953fe86722fa316708418be3c98e150c6163',
    instructionSha256:
      '717486788bf3be5232f894b4526a9b04c3254ef207183e4ab9df79c6cd3c42a9',
  },
  {
    rule: 7,
    title: 'No rosters, counts or versions that discovery supplies',
    bodySha256:
      'fc760bed69b38579b19f846e47f09e14b091a7040fedf91d3560f195e30e49f1',
    instructionSha256:
      '86d6367d8373bb522a98772a68addf988216943d2c464542cfccc85d76691911',
  },
  {
    rule: 8,
    title: 'Role-gated capabilities',
    bodySha256:
      '0b07ae78b21d15ccb84b4d169a6a43b8b4f812730b06c7e8fc95135b2b3784e9',
    instructionSha256:
      'f82fc27c1590eb6bebdd6926f599c7dc5824b9a9ce6fcca1b387a5240bf33b2e',
  },
];

const RUBRIC_PATH = join(
  __dirname,
  '../../../../../../.claude/skills/skill-creator/references/prompt-authoring-rubric.md',
);

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The body under `## <rule>. <title>`, or `null` when that heading is absent. */
function rubricBody(
  rubric: string,
  rule: number,
  title: string,
): string | null {
  const lines = rubric.split(/\r?\n/);
  const start = lines.indexOf(`## ${rule}. ${title}`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

describe('generation prompt rules agree with the prompt-authoring rubric', () => {
  const rubric = readFileSync(RUBRIC_PATH, 'utf8');

  it('covers exactly the pinned rules, in order', () => {
    expect(GENERATION_RUBRIC_RULES.map((r) => [r.rule, r.title])).toEqual(
      PINNED_RUBRIC_RULES.map((r) => [r.rule, r.title]),
    );
  });

  it.each(PINNED_RUBRIC_RULES)(
    'rubric rule $rule keeps its pinned heading and body',
    ({ rule, title, bodySha256 }) => {
      const body = rubricBody(rubric, rule, title);
      expect(body).not.toBeNull();
      expect(sha256(normalizeWhitespace(body ?? ''))).toBe(bodySha256);
    },
  );

  it.each(PINNED_RUBRIC_RULES)(
    'prompt instruction for rule $rule matches its pinned hash',
    ({ rule, instructionSha256 }) => {
      const entry = GENERATION_RUBRIC_RULES.find((r) => r.rule === rule);
      expect(entry).toBeDefined();
      expect(sha256(entry?.instruction ?? '')).toBe(instructionSha256);
    },
  );

  it('formats every instruction verbatim under a RUBRIC RULES heading', () => {
    const block = formatRubricRulesBlock();
    expect(block.startsWith('RUBRIC RULES\n')).toBe(true);
    for (const { instruction } of GENERATION_RUBRIC_RULES) {
      expect(block).toContain(`- ${instruction}`);
    }
  });

  it('carries no task id or date in any instruction', () => {
    const block = formatRubricRulesBlock();
    expect(block).not.toMatch(/TASK_\d{4}_\d+/);
    expect(block).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
  });
});

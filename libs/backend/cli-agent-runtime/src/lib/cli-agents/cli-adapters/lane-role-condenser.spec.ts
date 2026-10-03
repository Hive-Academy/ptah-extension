import {
  condenseLaneRole,
  LANE_ROLE_MAX_CHARS,
  OMITTED_NAMES_MAX_CHARS,
  type LaneRoleParts,
} from './lane-role-condenser';

const HEADER = '## Role: tester\n\nYou are running as the `tester` role.\n\n';
const EMPTY_HEADER =
  '## Role: tester\n\nRead the file named below before you start.\n\n';
const SOURCE = '/ws/.claude/agents/tester.md';
const POINTER_TAIL = `The full definition is at \`${SOURCE}\`; read a section only when the task needs it.`;
const POINTER_START = '\n\nThis role was condensed for the lane';

function condense(body: string, maxChars?: number): string {
  const parts: LaneRoleParts = {
    header: HEADER,
    headerWithoutBody: EMPTY_HEADER,
    body,
    sourcePath: SOURCE,
  };
  return condenseLaneRole(parts, maxChars);
}

function section(
  name: string,
  paragraphs: number,
  paragraphChars = 400,
): string {
  const paragraph = 'x'.repeat(paragraphChars - 1) + '.';
  return (
    `## ${name}\n\n` +
    Array.from({ length: paragraphs }, () => paragraph).join('\n\n') +
    '\n\n'
  );
}

/** A body of whole sections reaching at least `targetChars`. */
function sectionedBody(targetChars: number): string {
  let body = 'Opening identity and contract.\n\n';
  for (let index = 1; body.length < targetChars; index++) {
    body += section(`Part ${index}`, 4);
  }
  return body;
}

/** The text between the header and the pointer line. */
function keptText(result: string): string {
  return result.slice(HEADER.length, result.lastIndexOf(POINTER_START));
}

function pointerOf(result: string): string {
  return result.slice(result.lastIndexOf(POINTER_START) + 2);
}

describe('condenseLaneRole', () => {
  it('caps at 10,000 characters by default', () => {
    expect(LANE_ROLE_MAX_CHARS).toBe(10_000);
  });

  it('returns a block within the cap unchanged (5k body)', () => {
    const body = sectionedBody(5_000);

    expect(condense(body)).toBe(HEADER + body);
  });

  it.each([12_000, 25_000])(
    'keeps the opening text and whole sections in order for a %i-char body',
    (size) => {
      const body = sectionedBody(size);
      const result = condense(body);

      expect(result.length).toBeLessThanOrEqual(LANE_ROLE_MAX_CHARS);
      expect(result.startsWith(HEADER + 'Opening identity and contract.')).toBe(
        true,
      );
      expect(result.endsWith(POINTER_TAIL)).toBe(true);
      expect(body.startsWith(keptText(result))).toBe(true);
    },
  );

  it('names every omitted heading in the pointer and only those', () => {
    const body =
      'Intro.\n\n' +
      section('Alpha', 2) +
      section('Beta', 2) +
      section('Gamma', 2) +
      section('Delta', 2);
    const result = condense(body, 2_600);

    expect(result.length).toBeLessThanOrEqual(2_600);
    expect(result).toContain('## Alpha');
    expect(pointerOf(result)).not.toMatch(/omitted:.*Alpha/);
    expect(pointerOf(result)).toMatch(/omitted: .*Delta\./);
  });

  it('cuts the first section that does not fit at its last paragraph break', () => {
    const body = 'Intro.\n\n' + section('Alpha', 2) + section('Beta', 12);
    const result = condense(body, 4_000);

    expect(result.length).toBeLessThanOrEqual(4_000);
    expect(result).toContain('## Beta');
    expect(pointerOf(result)).toContain('omitted: Beta (cut short).');
    // The kept part of Beta ends on a whole paragraph.
    expect(keptText(result).endsWith('x.')).toBe(true);
    expect(body.startsWith(keptText(result))).toBe(true);
  });

  describe('paragraph-less text (H1)', () => {
    it('hard-cuts a single 50,000-char run instead of dropping it', () => {
      const body = 'x'.repeat(50_000);
      const result = condense(body);

      expect(result.length).toBeLessThanOrEqual(LANE_ROLE_MAX_CHARS);
      expect(result.startsWith(HEADER)).toBe(true);
      expect(keptText(result).length).toBeGreaterThan(8_000);
      expect(body.startsWith(keptText(result))).toBe(true);
      expect(pointerOf(result)).toContain(
        'omitted: the rest of the opening text.',
      );
    });

    it('cuts 5,000 single-newline lines at the last line break', () => {
      const lines = Array.from(
        { length: 5_000 },
        (_, n) => `- item ${n} of a long list`,
      );
      const body = lines.join('\n');
      const result = condense(body);
      const kept = keptText(result);

      expect(result.length).toBeLessThanOrEqual(LANE_ROLE_MAX_CHARS);
      expect(kept.length).toBeGreaterThan(8_000);
      // Whole lines only.
      expect(lines).toContain(kept.split('\n').at(-1));
      expect(body.startsWith(kept)).toBe(true);
    });

    it('cuts a 30k-paragraph section short and still keeps a small later section', () => {
      const body =
        'Intro.\n\n' +
        `## A\n\n${'a'.repeat(30_000)}\n\n` +
        '## B\n\nThe small closing section.\n';
      const result = condense(body);

      expect(result.length).toBeLessThanOrEqual(LANE_ROLE_MAX_CHARS);
      expect(result).toContain('## A\n\naaaa');
      expect(result).toContain('## B\n\nThe small closing section.');
      expect(result.indexOf('## A')).toBeLessThan(result.indexOf('## B'));
      expect(pointerOf(result)).toContain('omitted: A (cut short).');
    });

    it('never splits a surrogate pair on a hard cut', () => {
      const body = '\u{1F600}'.repeat(20_000);
      const kept = keptText(condense(body));

      expect(kept.length % 2).toBe(0);
      expect(body.startsWith(kept)).toBe(true);
    });

    it('closes a fence left open by a hard cut', () => {
      const body = 'Intro line\n```ts\n' + 'c'.repeat(20_000) + '\n```\n';
      const result = condense(body);

      expect(result.length).toBeLessThanOrEqual(LANE_ROLE_MAX_CHARS);
      expect((result.match(/```/g) ?? []).length % 2).toBe(0);
    });

    it('uses the no-body header when nothing of the body fits', () => {
      const body = '## Only\n\n' + 'z'.repeat(5_000);
      const result = condense(body, HEADER.length + 300);

      expect(result.startsWith(EMPTY_HEADER)).toBe(true);
      expect(result).not.toContain('zzz');
      expect(result).toContain(POINTER_TAIL);
    });
  });

  describe('pointer budget and cost (H2, H3)', () => {
    function manySections(count: number): string {
      return (
        'Intro.\n\n' +
        Array.from(
          { length: count },
          (_, i) => `## Heading number ${i}\n\nShort body ${i}.\n\n`,
        ).join('')
      );
    }

    it('bounds the omitted list so 3,000 sections still leave kept text', () => {
      const result = condense(manySections(3_000));
      const pointer = pointerOf(result);
      const listStart = pointer.indexOf('omitted: ') + 'omitted: '.length;
      const listEnd = pointer.indexOf('. The full definition');
      const list = pointer.slice(listStart, listEnd);

      expect(result.length).toBeLessThanOrEqual(LANE_ROLE_MAX_CHARS);
      expect(keptText(result).length).toBeGreaterThan(8_000);
      expect(keptText(result).startsWith('Intro.')).toBe(true);
      expect(list).toMatch(/; and \d+ more$/);
      expect(list.replace(/; and \d+ more$/, '').length).toBeLessThanOrEqual(
        OMITTED_NAMES_MAX_CHARS,
      );
    });

    it('condenses 8,000 sections in under 200 ms', () => {
      const body = manySections(8_000);
      const started = performance.now();
      const result = condense(body);
      const elapsed = performance.now() - started;

      expect(result.length).toBeLessThanOrEqual(LANE_ROLE_MAX_CHARS);
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('fences', () => {
    it('ignores ## lines and paragraph breaks inside fenced code blocks', () => {
      const fenced =
        '## Return value\n\nUse this shape:\n\n```markdown\n## Not a section\n\n' +
        'y'.repeat(3_000) +
        '\n\n## Also not a section\n```\n\n' +
        'z'.repeat(3_000) +
        '.\n\n';
      const body = 'Intro.\n\n' + fenced + section('After', 10);
      const result = condense(body, 5_000);

      expect(pointerOf(result)).not.toMatch(/not a section/i);
      expect(pointerOf(result)).toContain('Return value (cut short)');
      expect(result).toContain('## Also not a section\n```');
      expect((result.match(/```/g) ?? []).length % 2).toBe(0);
    });

    it('does not close a fence on an info-string line (H7)', () => {
      const body =
        'Intro.\n\n' +
        // "```ts" inside the open fence must not close it, so the "## " line
        // after it stays example content.
        '## Example\n\n```markdown\nNested:\n```ts\n## Inside the example\n```\n\n' +
        'w'.repeat(500) +
        '.\n\n' +
        section('Real', 30);
      const result = condense(body, 3_000);

      expect(pointerOf(result)).not.toContain('Inside the example');
      expect(pointerOf(result)).toContain('Real');
    });
  });

  it('is deterministic and shares no state between calls', () => {
    const a = sectionedBody(25_000);
    const first = condense(a);
    condenseLaneRole({
      header: HEADER,
      headerWithoutBody: EMPTY_HEADER,
      body: sectionedBody(12_000),
      sourcePath: '/other/path.md',
    });

    expect(condense(a)).toBe(first);
  });
});

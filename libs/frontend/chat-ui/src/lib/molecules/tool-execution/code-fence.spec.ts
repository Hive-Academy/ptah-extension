import { fenceCodeBlock } from './code-fence';

describe('fenceCodeBlock', () => {
  it.each([0, 3, 10])('contains a run of %i backticks', (length) => {
    const inner = '`'.repeat(length);
    const content = `${inner}\n<div class="fixed">x</div>\n${inner}`;
    const fence = '`'.repeat(Math.max(3, length + 1));

    expect(fenceCodeBlock(content, 'text')).toBe(
      `${fence}text\n${content}\n${fence}`,
    );
  });

  it('uses the longest run and preserves the language', () => {
    expect(fenceCodeBlock('```\n``````````', 'diff')).toBe(
      '```````````diff\n```\n``````````\n```````````',
    );
  });
});

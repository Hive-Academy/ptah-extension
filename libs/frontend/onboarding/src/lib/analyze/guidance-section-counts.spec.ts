import { parseGuidanceSectionCounts } from './guidance-section-counts';

const marker = '## Project-Specific Guidance';
const full = `${marker}\n### Project Context\nOne two\n### Framework Guidelines\nThree\n### Coding Standards\nFour five\n### Architecture Notes\nSix`;

describe('parseGuidanceSectionCounts', () => {
  it('counts the full four-section output in canonical order', () => {
    expect(parseGuidanceSectionCounts(full)?.sections).toEqual([
      { name: 'Project Context', wordCount: 2, generated: true },
      { name: 'Framework Guidelines', wordCount: 1, generated: true },
      { name: 'Coding Standards', wordCount: 2, generated: true },
      { name: 'Architecture Notes', wordCount: 1, generated: true },
    ]);
  });
  it('excludes the core-prompt prefix before the first marker', () => {
    expect(parseGuidanceSectionCounts(`CORE\n### Project Context\nwrong\n${full}`)?.sections[0].wordCount).toBe(2);
  });
  it.each([null, '', '  \n ', '### Project Context\ntext', '# Project-Specific Guidance\n### Project Context\ntext', marker])(
    'returns null for absent or unsupported guidance %s', (content) => {
      expect(parseGuidanceSectionCounts(content)).toBeNull();
    },
  );
  it('marks a missing middle section absent', () => {
    expect(parseGuidanceSectionCounts(`${marker}\n### Project Context\nA\n### Coding Standards\nB`)?.sections[1])
      .toEqual({ name: 'Framework Guidelines', wordCount: 0, generated: false });
  });
  it('normalizes CRLF and accepts trailing heading whitespace', () => {
    expect(parseGuidanceSectionCounts(`${marker}  \r\n### Project Context  \r\nA B`)?.sections[0].wordCount).toBe(2);
  });
  it('counts nested and non-canonical headings as words', () => {
    const content = `${marker}\n### Project Context\nA\n#### Sub\nB\n### Other\nC\n## Notes\nD`;
    expect(parseGuidanceSectionCounts(content)?.sections[0].wordCount).toBe(10);
  });
  it('counts an earlier canonical name repeated inside a later section as content', () => {
    const content = `${marker}\n### Project Context\nA\n### Framework Guidelines\nB\n### Project Context\nC`;
    expect(parseGuidanceSectionCounts(content)?.sections[1].wordCount).toBe(5);
  });
  it('splits at a later canonical heading appearing early', () => {
    const content = `${marker}\n### Project Context\nA\n### Framework Guidelines\nB\n### Framework Guidelines\nC\n### Coding Standards\nD`;
    expect(parseGuidanceSectionCounts(content)?.sections.map((section) => section.wordCount)).toEqual([1, 5, 1, 0]);
  });
  it('requires exact case and space after hashes', () => {
    const content = `${marker}\n###Project Context\nA\n### project context\nB\n### Coding Standards\nC`;
    expect(parseGuidanceSectionCounts(content)?.sections[0].generated).toBe(false);
  });
  it('keeps a whitespace-only section generated with zero words', () => {
    expect(parseGuidanceSectionCounts(`${marker}\n### Project Context\n  \n`)?.sections[0]).toEqual({ name: 'Project Context', wordCount: 0, generated: true });
  });
});

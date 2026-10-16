import { SentenceChunker, stripMarkdown } from './sentence-chunker';

describe('SentenceChunker', () => {
  it('flushes sentences incrementally and glues short fragments', () => {
    const chunker = new SentenceChunker();
    expect(chunker.push('OK. ')).toEqual([]);
    expect(chunker.push('The first answer is ready. ')).toEqual([
      'OK. The first answer is ready.',
    ]);
    expect(chunker.push('Another answer follows. ')).toEqual([
      'Another answer follows.',
    ]);
  });

  it('does not split decimals or abbreviations across tokens', () => {
    const chunker = new SentenceChunker();
    expect(chunker.push('Dr. Smith measured 3.')).toEqual([]);
    expect(chunker.push('14 seconds. ')).toEqual([
      'Dr. Smith measured 3.14 seconds.',
    ]);
  });

  it('recognizes Arabic and Urdu sentence endings', () => {
    const chunker = new SentenceChunker();
    expect(chunker.push('هل هذا التقدم مناسب؟ ')).toEqual([
      'هل هذا التقدم مناسب؟',
    ]);
    expect(chunker.push('یہ ایک مکمل جملہ ہے۔ ')).toEqual([
      'یہ ایک مکمل جملہ ہے۔',
    ]);
  });

  it('bounds run-on chunks and flushes the remainder', () => {
    const chunker = new SentenceChunker({ maxChars: 40 });
    const chunks = [...chunker.push('word '.repeat(30)), ...chunker.flush()];
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 40)).toBe(true);
    expect(chunker.isEmpty).toBe(true);
  });

  it('removes markdown decoration', () => {
    expect(stripMarkdown('## Heading **bold** and `code` ```secret```')).toBe(
      'Heading bold and code',
    );
  });
});

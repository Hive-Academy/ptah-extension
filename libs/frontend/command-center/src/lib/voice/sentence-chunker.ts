const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'e.g',
  'i.e',
  'vs',
  'etc',
]);

export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(
      /\*\*(.*?)\*\*|\*(.*?)\*|~~(.*?)~~/g,
      (_match, bold: string, italic: string, strike: string) =>
        bold || italic || strike,
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SentenceChunkerOptions {
  minChars?: number;
  maxChars?: number;
}

export class SentenceChunker {
  private buffer = '';
  private readonly minChars: number;
  private readonly maxChars: number;

  public constructor(options: SentenceChunkerOptions = {}) {
    this.maxChars = Math.max(1, options.maxChars ?? 250);
    this.minChars = Math.min(
      this.maxChars,
      Math.max(1, options.minChars ?? 12),
    );
  }

  public get isEmpty(): boolean {
    return this.buffer.trim().length === 0;
  }

  public push(token: string): string[] {
    this.buffer += token;
    return this.drain(false);
  }

  public flush(): string[] {
    const chunks = this.drain(true);
    if (this.buffer.trim()) chunks.push(stripMarkdown(this.buffer));
    this.buffer = '';
    return chunks.filter(Boolean);
  }

  private drain(final: boolean): string[] {
    const chunks: string[] = [];
    while (this.buffer.length > 0) {
      const boundary = this.findBoundary(final);
      let cut = boundary;
      if (cut === 0 && this.buffer.length >= this.maxChars) {
        const space = this.buffer.lastIndexOf(' ', this.maxChars);
        cut = space > this.minChars ? space : this.maxChars;
      }
      if (cut === 0) break;
      const piece = stripMarkdown(this.buffer.slice(0, cut));
      this.buffer = this.buffer.slice(cut).trimStart();
      if (piece) chunks.push(piece);
    }
    return chunks;
  }

  private findBoundary(final: boolean): number {
    const limit = Math.min(this.buffer.length, this.maxChars);
    for (let i = 0; i < limit; i++) {
      const char = this.buffer[i];
      if (!/[.!?؟۔…\n]/u.test(char)) continue;
      const next = this.buffer[i + 1];
      if (!next && !final) continue;
      if (
        char === '.' &&
        /\d/.test(this.buffer[i - 1] ?? '') &&
        /\d/.test(next ?? '')
      )
        continue;
      if (char === '.') {
        const word = this.buffer
          .slice(0, i)
          .match(/([\p{L}.]+)$/u)?.[1]
          ?.toLowerCase();
        if (word && ABBREVIATIONS.has(word)) continue;
      }
      if (next && !/\s|["')\]]/.test(next)) continue;
      if (i + 1 >= this.minChars) return i + 1;
    }
    return 0;
  }
}

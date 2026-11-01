import { StringDecoder } from 'node:string_decoder';

const MAX_BYTES = 8 * 1024;
const MAX_LINES = 50;

export function redactCodexDiagnostics(text: string): string {
  return text
    .replace(/\bAuthorization\s*:[^\r\n]*/gi, 'Authorization: [REDACTED]')
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[\w-]+/gi, '[REDACTED]')
    .replace(
      /\b(api[_-]?key|token)\s*=\s*(?:"[^"\r\n]*(?:"|$)|'[^'\r\n]*(?:'|$)|[^\s&,;]+)/gi,
      '$1=[REDACTED]',
    );
}

/** Bounded raw lines; redact before shortening so a cut cannot hide a secret's prefix. */
export class CodexStderrTail {
  private readonly decoder = new StringDecoder('utf8');
  private lines: string[] = [''];
  private droppingLine = false;

  append(chunk: Buffer | string): void {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    let offset = 0;
    while (offset < text.length) {
      const newline = text.indexOf('\n', offset);
      const end = newline < 0 ? text.length : newline;
      if (!this.droppingLine) {
        const last = this.lines.length - 1;
        // Check length before slicing, avoiding an unbounded retained intermediate.
        if (
          end - offset > MAX_BYTES ||
          Buffer.byteLength(this.lines[last]) +
            Buffer.byteLength(text.slice(offset, end)) >
            MAX_BYTES
        ) {
          this.lines[last] = '[stderr line exceeded limit]';
          this.droppingLine = true;
        } else this.lines[last] += text.slice(offset, end);
      }
      if (newline >= 0) {
        this.droppingLine = false;
        this.lines.push('');
      }
      while (this.lines.length > MAX_LINES || this.bytes() > MAX_BYTES)
        this.lines.shift();
      offset = end + 1;
    }
  }

  tail(maxBytes = MAX_BYTES): string {
    const limit = Number.isFinite(maxBytes)
      ? Math.max(0, Math.min(MAX_BYTES, Math.floor(maxBytes)))
      : MAX_BYTES;
    let text = redactCodexDiagnostics(this.lines.join('\n'));
    while (Buffer.byteLength(text) > limit) {
      const codePoint = text.codePointAt(0);
      text = text.slice(codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
    }
    return text;
  }

  private bytes(): number {
    return Buffer.byteLength(this.lines.join('\n'));
  }
}

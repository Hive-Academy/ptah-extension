const MAX_LINE_CHARS = 8_192;

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
/** OSC sequences (`ESC ] ... BEL` or `ESC ] ... ESC \`), e.g. hyperlinks. */
const ANSI_OSC = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g');
/** CSI sequences (`ESC [ ... final`), e.g. colours and cursor moves. */
const ANSI_CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');

/** Strip ANSI CSI/OSC escape sequences. */
export function stripAnsi(line: string): string {
  return line.replace(ANSI_OSC, '').replace(ANSI_CSI, '');
}

/** All `https:` candidates in order, with trailing punctuation removed. */
export function httpsUrlCandidates(line: string): string[] {
  return [...line.matchAll(/https:\/\/[^\s"'<>`]+/g)]
    .map(match => match[0].replace(/[).,;:!?\]]+$/, ''));
}

/** Parse a bounded HTTPS candidate. */
export function parseHttpsUrl(candidate: string, maxLength: number): string | undefined {
  if (candidate.length > maxLength) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    // degradation-audit: optional-capability - an unparseable URL is not a
    // verification URL; parsing continues with the next line.
    return undefined;
  }
}

/** First `https:` URL in `line`, validated, without trailing punctuation. */
export function extractHttpsUrl(line: string): string | undefined {
  const first = httpsUrlCandidates(line)[0];
  return first === undefined ? undefined : parseHttpsUrl(first, 2048);
}

/** Decode a stream into lines without keeping more than one line in memory. */
export class LineSplitter {
  private buffer = '';

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: unknown): void {
    if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk)) return;
    this.buffer += chunk.toString();
    const lines = this.buffer.split(/\r?\n|\r/);
    this.buffer = lines.pop() ?? '';
    if (this.buffer.length > MAX_LINE_CHARS) this.buffer = '';
    for (const line of lines) {
      if (line.length <= MAX_LINE_CHARS) this.onLine(line);
    }
  }
}

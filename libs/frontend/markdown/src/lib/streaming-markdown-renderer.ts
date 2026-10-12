import { Marked } from 'marked';
import { getMarkedExtensions } from './marked-extensions';
import { sanitizeFullMarkdownHtml } from './provide-markdown-rendering';

/**
 * One completed block of a streaming message. `html` is the output of exactly
 * one `sanitizeFullMarkdownHtml` call for this block alone; it must be inserted
 * into its own element and never concatenated with another block's HTML.
 */
export interface StreamingMarkdownBlock {
  readonly id: number;
  readonly html: string;
}

/** Result of one {@link StreamingMarkdownRenderer.render} call. */
export interface StreamingMarkdownRender {
  /** Append-only; the same array reference while no block is added. */
  readonly blocks: readonly StreamingMarkdownBlock[];
  /** Raw text after the last completed block. Never HTML: render it as text. */
  readonly tail: string;
  /**
   * True on exactly one render: the one where incremental rendering stopped
   * because the same boundary failed twice. Every later render of this message
   * returns the existing blocks plus raw tail text, with no parse or sanitize.
   */
  readonly failed: boolean;
}

/** Incremental renderer for a growing markdown value. */
export class StreamingMarkdownRenderer {
  private readonly marked = createMarked();
  private source = '';
  private blocks: readonly StreamingMarkdownBlock[] = [];
  /** Never reset, so blocks built after a non-prefix change get fresh ids. */
  private nextId = 0;
  /** Start offset of the slice whose last render attempt failed, or -1. */
  private failedAt = -1;
  /**
   * The source at the render that stopped incremental rendering, or `null`
   * while it runs. A later source that does not extend it is a new message
   * and resets the renderer.
   */
  private stoppedAt: string | null = null;

  render(source: string): StreamingMarkdownRender {
    if (
      !source.startsWith(this.source) ||
      (this.stoppedAt !== null && !source.startsWith(this.stoppedAt))
    ) {
      this.reset();
    }
    let failed = false;
    const completedEnd =
      this.stoppedAt !== null ? this.source.length : completedBlockEnd(source, this.source.length);
    if (completedEnd > this.source.length) {
      const start = this.source.length;
      const html = this.renderBlock(source.slice(start, completedEnd));
      if (html === null) {
        // The slice stays in the raw-text tail. Retry the boundary once (a
        // transient failure), then stop: retrying every frame would re-parse a
        // region that grows with the message.
        if (this.failedAt === start) {
          this.stoppedAt = source;
          failed = true;
        } else {
          this.failedAt = start;
        }
      } else {
        if (html.trim() !== '') this.blocks = [...this.blocks, { id: this.nextId++, html }];
        this.source = source.slice(0, completedEnd);
        this.failedAt = -1;
      }
    }
    // Leading newlines left after a closing fence are block separators, not
    // text; dropping them keeps a pre-line tail from opening with a blank line.
    return {
      blocks: this.blocks,
      tail: source.slice(this.source.length).replace(/^\n+/, ''),
      failed,
    };
  }

  /** Parses and sanitizes one completed slice on its own, or `null` when either step throws. */
  private renderBlock(markdown: string): string | null {
    try {
      return sanitizeFullMarkdownHtml(this.marked.parse(markdown, { async: false }));
    } catch {
      // degradation-audit: reported — a second failure at the same boundary
      // returns `failed`, which the caller logs once before it streams the
      // rest as plain text until the settled render replaces it.
      return null;
    }
  }

  private reset(): void {
    this.source = '';
    this.blocks = [];
    this.failedAt = -1;
    this.stoppedAt = null;
  }
}

function createMarked(): Marked {
  const marked = new Marked();
  marked.use(...getMarkedExtensions());
  return marked;
}

/** End of the last complete block at or after `from` (which is always a block boundary). */
function completedBlockEnd(source: string, from: number): number {
  const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*$/gm;
  fence.lastIndex = from;
  let end = from;
  let open: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(source)) !== null) {
    if (open === null) {
      // An opening fence interrupts any paragraph, so everything before it is complete.
      end = Math.max(end, match.index);
      open = match;
    } else if (match[1][0] === open[1][0] && match[1].length >= open[1].length) {
      const newline = source.indexOf('\n', match.index);
      end = newline === -1 ? source.length : newline + 1;
      fence.lastIndex = end;
      open = null;
    }
  }
  return open === null ? paragraphBoundary(source, end, source.length) : end;
}

/** Position after the last blank line in [start, limit), or `start` when there is none. */
function paragraphBoundary(source: string, start: number, limit: number): number {
  const boundary = source.lastIndexOf('\n\n', limit - 2);
  return boundary >= start ? boundary + 2 : start;
}

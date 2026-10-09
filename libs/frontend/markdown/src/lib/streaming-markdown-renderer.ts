import { Marked } from 'marked';
import { getMarkedExtensions } from './marked-extensions';
import { sanitizeFullMarkdownHtml } from './provide-markdown-rendering';

/** Incremental renderer for a growing markdown value. */
export class StreamingMarkdownRenderer {
  private readonly marked = createMarked();
  private source = '';
  private completedHtml = '';

  render(source: string): string {
    if (!source.startsWith(this.source)) this.reset();
    const completedEnd = completedBlockEnd(source, this.source.length);
    if (completedEnd > this.source.length) {
      this.completedHtml += this.marked.parse(source.slice(this.source.length, completedEnd));
      this.source = source.slice(0, completedEnd);
    }
    const tail = source.slice(this.source.length);
    return sanitizeFullMarkdownHtml(`${this.completedHtml}${tail ? `<p>${escapeHtml(tail).replace(/\n/g, '<br>')}</p>` : ''}`);
  }

  private reset(): void { this.source = ''; this.completedHtml = ''; }
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

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

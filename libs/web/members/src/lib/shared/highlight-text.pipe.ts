import { Pipe, type PipeTransform } from '@angular/core';

import type { SearchExcerpt, SearchMatch } from '@ptah-contracts/community';

/**
 * One run of text, and whether it is inside a match.
 *
 * ⚠️ IT IS TEXT, NOT MARKUP. The template renders these as sibling `<span>`s —
 * `{{ segment.text }}` — so every character reaches the DOM as a TEXT NODE and
 * Angular escapes it on the way. There is no HTML string anywhere in this
 * pipeline, which is what makes highlighting incapable of being an injection
 * path.
 */
export interface HighlightSegment {
  readonly text: string;
  readonly match: boolean;
}

/**
 * HighlightTextPipe — turns the server's `{ text, matches: {start,length}[] }`
 * into a list of text runs the template renders as sibling spans (R1.7.5, §5.5).
 *
 * ⚠️ THIS PIPE IS THE SINGLE MOST TEMPTING PLACE IN THE MEMBER PANEL TO REACH
 * FOR `innerHTML`, AND THE WHOLE SEARCH DESIGN EXISTS TO MAKE THAT UNNECESSARY.
 *
 * The obvious implementation returns `"...the <mark>bug</mark> in..."` and binds
 * it with `[innerHTML]`. That string would be MEMBER-AUTHORED text with markup
 * spliced into it, bound into the DOM as HTML — an XSS sink on every search
 * result, and one that bypasses `libs/frontend/markdown`'s `'member'` preset,
 * the ONE sanitizer in the product (PRE-4, AD-1). It is also the reason the API
 * returns offsets instead of doing the highlighting itself: a server-highlighted
 * string can only be displayed by rendering it as HTML.
 *
 * So this pipe NEVER PRODUCES AN HTML STRING, and `markdown-chokepoint.spec.ts`
 * fails the build if one appears anywhere under `libs/web/members`.
 *
 * ⚠️ IT IS NEVER APPLIED TO MARKDOWN OUTPUT (R1.7.5). An excerpt is displayed
 * AS-IS — markdown syntax and all — precisely so a search result never runs a
 * second rendering pipeline. Splitting rendered HTML on character offsets would
 * cut through tags and produce broken markup, which is the other half of why
 * excerpts are plain text.
 *
 * ⚠️ A MALFORMED OFFSET DEGRADES TO PLAIN TEXT, IT NEVER THROWS. The server
 * computes the offsets and promises them ascending, non-overlapping and in
 * range; this pipe does not trust that, because a pipe that can crash a page on
 * a boundary case is strictly worse than one that renders the excerpt
 * un-highlighted. Every rejection path returns the whole text as one unmatched
 * segment — the member still reads their result, they just do not see the
 * emphasis.
 *
 * `pure: true` (the default) is correct: the output is a function of the input
 * object, and search results are replaced wholesale rather than mutated.
 */
@Pipe({ name: 'highlightText', standalone: true })
export class HighlightTextPipe implements PipeTransform {
  public transform(
    excerpt: SearchExcerpt | null | undefined,
  ): readonly HighlightSegment[] {
    if (!excerpt || typeof excerpt.text !== 'string') return [];

    const { text, matches } = excerpt;
    if (text.length === 0) return [];

    if (!Array.isArray(matches) || matches.length === 0) {
      return [{ text, match: false }];
    }

    if (!isRenderable(matches, text.length)) {
      return [{ text, match: false }];
    }

    const segments: HighlightSegment[] = [];
    let cursor = 0;

    for (const { start, length } of matches) {
      if (start > cursor) {
        segments.push({ text: text.slice(cursor, start), match: false });
      }
      segments.push({ text: text.slice(start, start + length), match: true });
      cursor = start + length;
    }

    if (cursor < text.length) {
      segments.push({ text: text.slice(cursor), match: false });
    }

    return segments;
  }
}

/**
 * Whether the whole match list can be laid over `text` without ambiguity.
 *
 * ⚠️ ALL-OR-NOTHING, ON PURPOSE. Dropping only the bad entries and keeping the
 * rest would highlight a DIFFERENT set of characters than the server intended
 * while looking entirely correct — a silent wrong answer. Falling back to plain
 * text is a visible, honest degradation.
 *
 * The four rejections, each a real shape a buggy producer emits:
 *   · a non-integer or negative `start`  → `slice` would silently count from
 *     the end of the string;
 *   · a zero or negative `length`        → an empty highlighted span, or a
 *     backwards slice;
 *   · `start + length > text.length`     → a match pointing past the excerpt,
 *     which happens when a window is truncated after the offsets are computed;
 *   · `start < cursor`                   → out of order or overlapping, which
 *     would emit the same characters twice.
 */
function isRenderable(
  matches: readonly SearchMatch[],
  textLength: number,
): boolean {
  let cursor = 0;

  for (const match of matches) {
    if (!Number.isInteger(match?.start) || !Number.isInteger(match?.length)) {
      return false;
    }
    if (match.start < 0 || match.length <= 0) return false;
    if (match.start < cursor) return false;
    if (match.start + match.length > textLength) return false;
    cursor = match.start + match.length;
  }

  return true;
}

export type SpokenTextKind = 'reply' | 'status';

const CUE = ' See text for the rest';

function stripUnifiedDiff(text: string): string {
  let inDiff = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^(?:diff --git |--- a\/|\+\+\+ b\/|@@ .*@@)/.test(line)) {
        inDiff = true;
        return '';
      }
      if (inDiff) {
        if (!line.trim()) {
          inDiff = false;
          return '';
        }
        if (/^(?:index [0-9a-f]+|[ +\\-])/.test(line)) return '';
        inDiff = false;
      }
      return line;
    })
    .join('\n');
}

/** Returns only safe, short assistant prose for speech. The original text is untouched. */
export function toSpokenText(
  text: string,
  kind: SpokenTextKind = 'reply',
): string {
  const limit = kind === 'status' ? 180 : 600;
  const clean = stripUnifiedDiff(text)
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/<tool_(?:call|result)>[\s\S]*?<\/tool_(?:call|result)>/gi, ' ')
    .replace(
      /^\s*(?:Tool (?:call|result):|(?:Calling|Called) tool:).*$/gim,
      ' ',
    )
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/\b(?:sk|pk|rk)[_-](?:live|test)[_-][A-Za-z0-9_-]{12,}\b/g, ' ')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, ' ')
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, ' ')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*|~~|(?<!\w)\*(?!\s)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return '';
  let count = 0;
  let sentenceEnd = clean.length;
  for (let i = 0; i < clean.length; i++) {
    if (
      /[.!?؟۔]/u.test(clean[i]) &&
      (i === clean.length - 1 || /\s/.test(clean[i + 1]))
    ) {
      count++;
      if (count === 4) {
        sentenceEnd = i + 1;
        break;
      }
    }
  }
  const cut = Math.min(limit, sentenceEnd);
  if (clean.length <= cut) return clean;
  const prefix = clean.slice(0, Math.max(0, limit - CUE.length));
  const bounded = prefix
    .slice(0, Math.min(prefix.length, sentenceEnd))
    .trimEnd();
  return `${bounded}${CUE}`;
}

/** Longest reply excerpt shown as a caption when the reply is not spoken. */
export const REPLY_EXCERPT_MAX_CHARS = 160;

/**
 * First prose sentence of an assistant reply, for the stage caption when no
 * speech plays. Code, diffs, tool output and secrets are dropped as for speech.
 */
export function replyExcerpt(
  text: string,
  max = REPLY_EXCERPT_MAX_CHARS,
): string {
  const prose = toSpokenText(text, 'reply');
  if (!prose) return '';
  const end = prose.search(/[.!?؟۔](?:\s|$)/u);
  const sentence = (end < 0 ? prose : prose.slice(0, end + 1)).trim();
  if (sentence.length <= max) return sentence;
  return `${sentence.slice(0, max - 1).trimEnd()}…`;
}

export function sanitizeReviewFailureMessage(value: string): string {
  return value
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)\b/gi, '[redacted]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[redacted]')
    .replace(/\b(authorization|x-api-key|api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/(?:[A-Za-z]:\\[^\s,;]+|\/(?:[^\s/,;]+\/)+[^\s,;]+)/g, '[redacted path]')
    .replace(/ignore previous instructions|system prompt|developer message/gi, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ').slice(0, 300);
}

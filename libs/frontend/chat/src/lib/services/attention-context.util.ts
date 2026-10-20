const UNSAFE_CONTEXT = /(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+\\|(?:^|\s)\/(?:[^\s/]+\/[^\s]+|(?:tmp|etc|var|usr|home|opt|root|bin|sbin|dev|proc|mnt|srv|Users|private|Volumes|System)(?=$|\s|[\/.,!?;:)\]}]))|(?:^|\s)~\/[^\s]+|(?:^|\s)(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+(?=\s|$)|\bsk-[\w-]{8,}\b|\bAKIA[0-9A-Z]{16}\b|\bghp_[A-Za-z0-9_]+\b|\bxoxb-[A-Za-z0-9-]+\b|\b[0-9a-f]{32,}\b|\b[A-Za-z0-9+/_-]{40,}={0,2}\b)/i;

export const isUnsafeAttentionContext = (value: string): boolean => UNSAFE_CONTEXT.test(value);

export const attentionContext = (parts: readonly string[]): string => {
  const present = parts.filter(Boolean);
  let joined = present.join(' · ');
  if (joined.length <= 80) return joined;
  const variableIndices = present.length > 2 && !present.at(-1)?.startsWith('Tool: ')
    ? [present.length - 1, 1] : [1];
  for (const index of variableIndices) {
    if (index >= present.length || joined.length <= 80) break;
    const excess = joined.length - 80;
    present[index] = present[index].length > excess + 1
      ? `${present[index].slice(0, -excess - 1)}…` : '';
    joined = present.filter(Boolean).join(' · ');
  }
  return joined.length > 80 ? `${joined.slice(0, 79)}…` : joined;
};

import React from 'react';

import { Badge } from './Badge.js';

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheCreation?: number;
}

export interface TokenBadgeProps {
  tokens: TokenUsage | number;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

export function TokenBadge({ tokens }: TokenBadgeProps): React.JSX.Element {
  const total =
    typeof tokens === 'number'
      ? tokens
      : tokens.input +
        tokens.output +
        (tokens.cacheRead ?? 0) +
        (tokens.cacheCreation ?? 0);

  return <Badge variant="outline">{formatTokens(total)} tokens</Badge>;
}

export default TokenBadge;

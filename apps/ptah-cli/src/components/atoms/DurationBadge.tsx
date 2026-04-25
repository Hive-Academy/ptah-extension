import React from 'react';

import { Badge } from './Badge.js';

export interface DurationBadgeProps {
  durationMs: number;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds - minutes * 60);
  return remainingSeconds > 0
    ? `${minutes}m ${remainingSeconds}s`
    : `${minutes}m`;
}

export function DurationBadge({
  durationMs,
}: DurationBadgeProps): React.JSX.Element {
  return <Badge variant="ghost">{formatDuration(durationMs)}</Badge>;
}

export default DurationBadge;

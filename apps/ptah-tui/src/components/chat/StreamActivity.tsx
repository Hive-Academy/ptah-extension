import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import InkSpinner from 'ink-spinner';

import { useTheme } from '../../hooks/use-theme.js';
import { useSessionContext } from '../../context/SessionContext.js';
import { formatElapsed, formatTokenCount } from '../../lib/status-line.js';
import { GLYPHS } from '../../lib/glyphs.js';

interface StreamActivityProps {
  readonly label?: string;
}

/**
 * The live affordance for a running turn: spinner, elapsed time, tokens so far,
 * and how to stop it.
 *
 * Without an elapsed counter a slow turn is indistinguishable from a hung one —
 * which is exactly the complaint that opened this task. The clock is local
 * state on a one-second interval rather than something threaded through the
 * chat controller, so it costs one re-render per second and nothing else.
 */
export function StreamActivity({
  label = 'Working',
}: StreamActivityProps): React.JSX.Element {
  const theme = useTheme();
  const { stats } = useSessionContext();
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    setElapsedMs(0);
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const tokens =
    stats !== null && stats.outputTokens > 0
      ? formatTokenCount(stats.outputTokens)
      : null;

  return (
    <Box gap={1}>
      <Text color={theme.ui.accent}>
        <InkSpinner type="dots" />
      </Text>
      <Text color={theme.ui.muted}>{label}</Text>
      <Text color={theme.ui.dimmed}>{GLYPHS.separator}</Text>
      <Text color={theme.ui.dimmed}>{formatElapsed(elapsedMs)}</Text>
      {tokens !== null && (
        <>
          <Text color={theme.ui.dimmed}>{GLYPHS.separator}</Text>
          <Text color={theme.ui.dimmed}>{`${tokens} tok`}</Text>
        </>
      )}
      <Text color={theme.ui.dimmed}>{GLYPHS.separator}</Text>
      <Text color={theme.ui.dimmed}>esc to interrupt</Text>
    </Box>
  );
}

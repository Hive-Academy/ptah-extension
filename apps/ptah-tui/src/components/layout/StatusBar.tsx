/**
 * StatusBar -- Bottom bar showing session info, model, tokens, context,
 * cost, mode, and keyboard shortcuts.
 *
 * TASK_2025_266 Batch 3: Added context usage, cost, and mode indicators.
 *
 * Displays session context on the left and keyboard shortcuts on the right
 * with a styled separator. Shows streaming indicator when active.
 */

import React from 'react';
import { Box, Text } from 'ink';

import { useSessionContext } from '../../context/SessionContext.js';
import { useModeContext } from '../../context/ModeContext.js';
import { useTheme } from '../../hooks/use-theme.js';
import { KeyHint, ProgressBar } from '../atoms/index.js';

interface StatusBarProps {
  isStreaming: boolean;
}

function formatTokens(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

function formatCost(cost: number): string {
  if (cost === 0) return '--';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

export function StatusBar({ isStreaming }: StatusBarProps): React.JSX.Element {
  const theme = useTheme();
  const { sessions, activeSessionId, stats } = useSessionContext();
  const { mode } = useModeContext();

  const activeSession = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId)
    : null;
  const sessionName = activeSession?.name ?? null;
  const modelName = stats?.model ?? activeSession?.model ?? null;
  const tokenCount =
    stats && (stats.inputTokens > 0 || stats.outputTokens > 0)
      ? { input: stats.inputTokens, output: stats.outputTokens }
      : null;

  // Context usage color coding
  const contextPercent = stats?.contextUsagePercent ?? 0;
  const contextColor =
    contextPercent > 80
      ? theme.status.error
      : contextPercent >= 60
        ? theme.status.warning
        : theme.status.success;

  // Cost color coding
  const costValue = stats?.costUSD ?? 0;
  const costColor =
    costValue > 5
      ? theme.status.error
      : costValue >= 1
        ? theme.status.warning
        : theme.ui.dimmed;

  // Mode indicator
  const modeLabel = mode === 'plan' ? '[Plan]' : '[Build]';
  const modeColor = mode === 'plan' ? theme.status.info : theme.status.success;

  return (
    <Box
      borderStyle="bold"
      borderColor={theme.ui.border}
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      justifyContent="space-between"
    >
      <Box gap={1}>
        {sessionName ? (
          <>
            <Text color={theme.ui.accent} bold>
              {sessionName}
            </Text>
          </>
        ) : (
          <Text color={theme.ui.dimmed}>No session</Text>
        )}

        {modelName && (
          <>
            <Text color={theme.ui.border}>{'│'}</Text>
            <Text color={theme.ui.brand}>{modelName}</Text>
          </>
        )}

        {tokenCount && (
          <>
            <Text color={theme.ui.border}>{'│'}</Text>
            <Text color={theme.status.success}>
              {formatTokens(tokenCount.input)}
            </Text>
            <Text color={theme.ui.dimmed}>{'/'}</Text>
            <Text color={theme.status.warning}>
              {formatTokens(tokenCount.output)}
            </Text>
            <Text color={theme.ui.dimmed}> tokens</Text>
          </>
        )}

        {isStreaming && (
          <>
            <Text color={theme.ui.border}>{'│'}</Text>
            <Text color={theme.status.warning} bold>
              {'◉ Streaming'}
            </Text>
          </>
        )}

        {contextPercent > 0 && (
          <>
            <Text color={theme.ui.border}>{'│'}</Text>
            <ProgressBar percent={contextPercent} width={8} color={contextColor} />
            <Text color={contextColor}>{contextPercent}%</Text>
            {contextPercent > 90 && (
              <Text color={theme.status.error} bold>
                {' full!'}
              </Text>
            )}
          </>
        )}

        {activeSessionId && (
          <>
            <Text color={theme.ui.border}>{'│'}</Text>
            <Text color={costColor}>{formatCost(costValue)}</Text>
          </>
        )}

        <Text color={theme.ui.border}>{'│'}</Text>
        <Text color={modeColor} bold>
          {modeLabel}
        </Text>
      </Box>

      <Box>
        <KeyHint keys="^K" label="palette" />
        <KeyHint keys="^N" label="new" separator />
        <KeyHint keys="^B" label="agents" separator />
        <KeyHint keys="^E" label="sessions" separator />
        <KeyHint keys="^S" label="settings" separator />
        <KeyHint keys="^Q" label="quit" separator />
      </Box>
    </Box>
  );
}

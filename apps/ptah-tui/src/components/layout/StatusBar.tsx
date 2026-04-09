/**
 * StatusBar -- Bottom bar showing session info, model, tokens, and shortcuts.
 *
 * Displays session context on the left and keyboard shortcuts on the right
 * with a styled separator. Shows streaming indicator when active.
 */

import React from 'react';
import { Box, Text } from 'ink';

import { useSessionContext } from '../../context/SessionContext.js';

interface StatusBarProps {
  isStreaming: boolean;
}

function formatTokens(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

export function StatusBar({ isStreaming }: StatusBarProps): React.JSX.Element {
  const { sessions, activeSessionId, stats } = useSessionContext();

  const activeSession = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId)
    : null;
  const sessionName = activeSession?.name ?? null;
  const modelName = stats?.model ?? activeSession?.model ?? null;
  const tokenCount =
    stats && (stats.inputTokens > 0 || stats.outputTokens > 0)
      ? { input: stats.inputTokens, output: stats.outputTokens }
      : null;

  return (
    <Box
      borderStyle="bold"
      borderColor="#374151"
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
            <Text color="#06b6d4" bold>
              {sessionName}
            </Text>
          </>
        ) : (
          <Text color="#6b7280">No session</Text>
        )}

        {modelName && (
          <>
            <Text color="#374151">{'│'}</Text>
            <Text color="#7c3aed">{modelName}</Text>
          </>
        )}

        {tokenCount && (
          <>
            <Text color="#374151">{'│'}</Text>
            <Text color="#10b981">{formatTokens(tokenCount.input)}</Text>
            <Text color="#6b7280">{'/'}</Text>
            <Text color="#f59e0b">{formatTokens(tokenCount.output)}</Text>
            <Text color="#6b7280"> tokens</Text>
          </>
        )}

        {isStreaming && (
          <>
            <Text color="#374151">{'│'}</Text>
            <Text color="#f59e0b" bold>
              {'◉ Streaming'}
            </Text>
          </>
        )}
      </Box>

      <Box gap={1}>
        <Text color="#6b7280">^B</Text>
        <Text dimColor>sidebar</Text>
        <Text color="#374151">{'│'}</Text>
        <Text color="#6b7280">^S</Text>
        <Text dimColor>settings</Text>
        <Text color="#374151">{'│'}</Text>
        <Text color="#6b7280">^Q</Text>
        <Text dimColor>quit</Text>
      </Box>
    </Box>
  );
}

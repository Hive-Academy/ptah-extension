import React from 'react';
import { Box, Text, useStdout } from 'ink';

import type { ChatMessage } from '../../hooks/use-chat.js';
import { MessageBubble } from './MessageBubble.js';
import { useTheme } from '../../hooks/use-theme.js';
import { useTuiContext } from '../../context/TuiContext.js';
import { GLYPHS } from '../../lib/glyphs.js';
import { buildWelcome } from '../../lib/welcome.js';

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  authReady?: boolean;
  authError?: string;
  model?: string | null;
}

const MAX_VISIBLE_MESSAGES = 50;

interface WelcomeScreenProps {
  authReady: boolean;
  authError?: string;
  model?: string | null;
}

function WelcomeScreen({
  authReady,
  authError,
  model,
}: WelcomeScreenProps): React.JSX.Element {
  const theme = useTheme();
  const { workspacePath } = useTuiContext();
  const { stdout } = useStdout();

  const welcome = buildWelcome(
    {
      workspacePath,
      authReady,
      authError,
      model,
      columns: stdout.columns ?? 80,
    },
    GLYPHS,
  );

  const keyColumn = Math.max(
    ...welcome.actions.map((action) => action.keys.length),
  );

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="flex-end" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={theme.ui.brand} bold>
          {welcome.logo}
        </Text>
        <Text color={theme.ui.dimmed}>{`  ${welcome.tagline}`}</Text>
      </Box>

      <Box>
        <Text color={theme.ui.dimmed}>{'workspace  '}</Text>
        <Text color={theme.ui.muted}>{welcome.workspace}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={theme.ui.dimmed}>{'provider   '}</Text>
        <Text
          color={
            welcome.provider.ready ? theme.status.success : theme.status.warning
          }
        >
          {welcome.provider.label}
        </Text>
      </Box>

      {welcome.actions.map((action) => (
        <Box key={action.keys}>
          <Text color={theme.ui.accent} bold>
            {action.keys.padEnd(keyColumn)}
          </Text>
          <Text color={theme.ui.dimmed}>{`  ${action.label}`}</Text>
        </Box>
      ))}
    </Box>
  );
}

export function MessageList({
  messages,
  isStreaming,
  authReady = false,
  authError,
  model = null,
}: MessageListProps): React.JSX.Element {
  if (messages.length === 0 && !isStreaming) {
    return (
      <WelcomeScreen authReady={authReady} authError={authError} model={model} />
    );
  }

  // Cap the rendered history so the element tree can't grow unbounded; the
  // bounded viewport below keeps only the most recent messages on screen.
  const visible =
    messages.length > MAX_VISIBLE_MESSAGES
      ? messages.slice(-MAX_VISIBLE_MESSAGES)
      : messages;

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      overflow="hidden"
      justifyContent="flex-end"
      paddingX={1}
    >
      {visible.map((message) => (
        <MessageBubble
          key={message.id}
          role={message.role}
          content={message.content}
          thinking={message.thinking}
          tools={message.tools}
          isStreaming={message.isStreaming === true}
        />
      ))}
    </Box>
  );
}

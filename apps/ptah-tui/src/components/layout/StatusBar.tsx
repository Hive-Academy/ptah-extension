import React from 'react';
import { Box, Text } from 'ink';

import { useSessionContext } from '../../context/SessionContext.js';
import { useModeContext } from '../../context/ModeContext.js';
import { useTheme, type TuiTheme } from '../../hooks/use-theme.js';
import { GLYPHS } from '../../lib/glyphs.js';
import { deriveStatusLine, type Tone } from '../../lib/status-line.js';
import { getFooterHints, type FooterView } from '../../lib/keymap.js';

interface StatusBarProps {
  isStreaming: boolean;
  hasConversation: boolean;
  fallbackModel?: string | null;
  view: FooterView;
  panelOpen?: boolean;
  overlayOpen?: boolean;
}

function toneColor(theme: TuiTheme, tone: Tone): string {
  switch (tone) {
    case 'error':
      return theme.status.error;
    case 'warn':
      return theme.status.warning;
    case 'ok':
      return theme.status.success;
    default:
      return theme.ui.dimmed;
  }
}

/**
 * The one status line.
 *
 * Every field is derived by `deriveStatusLine` from a single input, which is
 * what makes the old contradiction — "No session" rendered beside the accrued
 * cost of the conversation you are having — unrepresentable. The footer hints
 * come from the keymap registry and are chosen for the current context rather
 * than being six hard-coded chords that overflowed an 80-column terminal.
 */
export function StatusBar({
  isStreaming,
  hasConversation,
  fallbackModel = null,
  view,
  panelOpen = false,
  overlayOpen = false,
}: StatusBarProps): React.JSX.Element {
  const theme = useTheme();
  const { sessions, activeSessionId, stats } = useSessionContext();
  const { mode } = useModeContext();

  const activeSession = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId)
    : undefined;

  const line = deriveStatusLine({
    activeSessionId,
    sessionName: activeSession?.name ?? null,
    hasConversation,
    isStreaming,
    fallbackModel: activeSession?.model ?? fallbackModel,
    stats,
    mode,
  });

  const hints = getFooterHints({
    view,
    isStreaming,
    overlayOpen,
    panelOpen,
  });

  const separator = (
    <Text color={theme.ui.borderSubtle}>{` ${GLYPHS.separator} `}</Text>
  );

  return (
    <Box paddingX={1} justifyContent="space-between" flexShrink={0}>
      <Box>
        <Text
          color={line.session.active ? theme.ui.accent : theme.ui.dimmed}
          bold={line.session.active}
          wrap="truncate"
        >
          {line.session.label}
        </Text>

        {line.model !== null && (
          <>
            {separator}
            <Text color={theme.ui.muted} wrap="truncate">
              {line.model}
            </Text>
          </>
        )}

        {line.tokens !== null && (
          <>
            {separator}
            <Text color={theme.ui.dimmed}>{`${line.tokens} tok`}</Text>
          </>
        )}

        {line.context !== null && (
          <>
            {separator}
            <Text color={toneColor(theme, line.context.tone)}>
              {`ctx ${line.context.percent}%`}
            </Text>
          </>
        )}

        {line.cost !== null && (
          <>
            {separator}
            <Text color={toneColor(theme, line.cost.tone)}>
              {line.cost.label}
            </Text>
          </>
        )}

        {line.activity !== null && (
          <>
            {separator}
            <Text color={theme.status.warning} bold>
              {line.activity.label}
            </Text>
          </>
        )}

        {separator}
        <Text
          color={line.mode.plan ? theme.status.info : theme.ui.dimmed}
          bold={line.mode.plan}
        >
          {line.mode.label}
        </Text>
      </Box>

      <Box>
        {hints.map((hint, index) => (
          <Box key={hint.id}>
            {index > 0 && (
              <Text color={theme.ui.borderSubtle}>{`  ${GLYPHS.separator}  `}</Text>
            )}
            <Text color={theme.ui.muted}>{hint.hint}</Text>
            <Text color={theme.ui.dimmed}>
              {` ${hint.footerLabel ?? ''}`}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

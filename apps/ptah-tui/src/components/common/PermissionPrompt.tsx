/**
 * PermissionPrompt -- Shows SDK tool call permission requests in a modal.
 *
 * TASK_2025_263 Batch 4
 *
 * The backend sends a PermissionRequest when an SDK tool (Bash, Write, Edit, etc.)
 * needs user approval. The user responds with Allow (Y), Deny (N), or Always Allow (A).
 *
 * Keyboard:
 *   Y - Allow (once)
 *   N - Deny
 *   A - Always Allow (creates a persistent rule)
 *   Escape - Deny (same as N)
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';

type PermissionDecision = 'allow' | 'deny' | 'always_allow';

interface PermissionPromptProps {
  toolName: string;
  description?: string;
  input?: Readonly<Record<string, unknown>>;
  onDecision: (decision: PermissionDecision) => void;
}

export function PermissionPrompt({
  toolName,
  description,
  input,
  onDecision,
}: PermissionPromptProps): React.JSX.Element {
  // isActive: true is explicit to document that this modal's input handler
  // should always be active when rendered (ModalOverlay only renders when visible).
  useInput(
    (char, key) => {
      const lower = char.toLowerCase();
      if (lower === 'y') {
        onDecision('allow');
      } else if (lower === 'n') {
        onDecision('deny');
      } else if (lower === 'a') {
        onDecision('always_allow');
      } else if (key.escape) {
        onDecision('deny');
      }
    },
    { isActive: true },
  );

  // Prettify input JSON, truncated to avoid flooding the terminal
  let inputDisplay: string | undefined;
  if (input && Object.keys(input).length > 0) {
    const raw = JSON.stringify(input, null, 2);
    const maxLines = 15;
    const lines = raw.split('\n');
    inputDisplay =
      lines.length > maxLines
        ? lines.slice(0, maxLines).join('\n') + '\n  ...(truncated)'
        : raw;
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="yellow">
        Permission Request
      </Text>
      <Box marginTop={1}>
        <Text>Tool: </Text>
        <Text bold color="cyan">
          {toolName}
        </Text>
      </Box>
      {description ? (
        <Box marginTop={1}>
          <Text>{description}</Text>
        </Box>
      ) : null}
      {inputDisplay ? (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          <Text dimColor>{inputDisplay}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color="green" bold>
          [Y]
        </Text>
        <Text> Allow </Text>
        <Text color="red" bold>
          [N]
        </Text>
        <Text> Deny </Text>
        <Text color="blue" bold>
          [A]
        </Text>
        <Text> Always Allow</Text>
      </Box>
    </Box>
  );
}

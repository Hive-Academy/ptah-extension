/**
 * CodeBlock -- Syntax-highlighted code block for the TUI.
 *
 * Renders a bordered box with language label and syntax highlighting
 * via cli-highlight. Falls back to plain text if highlighting fails.
 */

import React from 'react';
import { Box, Text } from 'ink';

let highlightSync:
  | ((code: string, options?: { language?: string }) => string)
  | null = null;

try {
  const cliHighlight = require('cli-highlight') as {
    highlight: (code: string, options?: { language?: string }) => string;
  };
  highlightSync = cliHighlight.highlight;
} catch {
  // cli-highlight not available -- fall back to plain text
}

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({
  code,
  language,
}: CodeBlockProps): React.JSX.Element {
  let displayCode = code;

  if (highlightSync && language) {
    try {
      displayCode = highlightSync(code, { language });
    } catch {
      // Highlighting failed -- use plain text
    }
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#374151"
      paddingX={1}
      marginY={0}
    >
      {language && (
        <Box
          borderStyle="single"
          borderColor="#1f2937"
          borderBottom
          borderTop={false}
          borderLeft={false}
          borderRight={false}
          marginBottom={0}
        >
          <Text color="#7c3aed" bold>
            {language}
          </Text>
        </Box>
      )}
      <Text>{displayCode}</Text>
    </Box>
  );
}

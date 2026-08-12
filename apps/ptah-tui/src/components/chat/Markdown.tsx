import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

import { useTheme, type TuiTheme } from '../../hooks/use-theme.js';
import { GLYPHS } from '../../lib/glyphs.js';
import {
  parseMarkdown,
  type InlineSpan,
  type MarkdownBlock,
} from '../../lib/markdown.js';
import { highlightLine, type CodeTokenKind } from '../../lib/code-highlight.js';

interface MarkdownProps {
  readonly text: string;
  /** Appends a cursor to the last block while the turn is still streaming. */
  readonly streaming?: boolean;
  readonly cursorColor?: string;
}

function InlineSpans({
  spans,
  theme,
}: {
  spans: readonly InlineSpan[];
  theme: TuiTheme;
}): React.JSX.Element {
  return (
    <>
      {spans.map((span, index) => {
        const key = `${span.kind}-${index}`;
        switch (span.kind) {
          case 'bold':
            return (
              <Text key={key} bold>
                {span.text}
              </Text>
            );
          case 'italic':
            return (
              <Text key={key} italic>
                {span.text}
              </Text>
            );
          case 'code':
            return (
              <Text key={key} color={theme.ui.accent}>
                {span.text}
              </Text>
            );
          case 'link':
            return (
              <Text key={key}>
                <Text color={theme.status.info} underline>
                  {span.text}
                </Text>
                <Text color={theme.ui.dimmed}>{` (${span.href})`}</Text>
              </Text>
            );
          default:
            return <Text key={key}>{span.text}</Text>;
        }
      })}
    </>
  );
}

function syntaxColor(theme: TuiTheme, kind: CodeTokenKind): string | undefined {
  switch (kind) {
    case 'comment':
      return theme.ui.dimmed;
    case 'string':
      return theme.status.success;
    case 'number':
      return theme.status.warning;
    case 'keyword':
      return theme.ui.brand;
    default:
      return undefined;
  }
}

function CodeBlockView({
  block,
  theme,
}: {
  block: Extract<MarkdownBlock, { kind: 'code' }>;
  theme: TuiTheme;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={theme.ui.dimmed}>{`${GLYPHS.gutter} `}</Text>
        <Text color={theme.ui.brand} bold>
          {block.language.length > 0 ? block.language : 'code'}
        </Text>
        {!block.closed && (
          <Text color={theme.ui.dimmed}>{` ${GLYPHS.running}`}</Text>
        )}
      </Box>
      {block.lines.map((line, index) => (
        <Box key={`line-${index}`}>
          <Text color={theme.ui.dimmed}>{`${GLYPHS.gutter} `}</Text>
          <Text wrap="wrap">
            {highlightLine(line, block.language).map((token, tokenIndex) => (
              <Text
                key={`token-${tokenIndex}`}
                color={syntaxColor(theme, token.kind)}
              >
                {token.text}
              </Text>
            ))}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function BlockView({
  block,
  theme,
}: {
  block: MarkdownBlock;
  theme: TuiTheme;
}): React.JSX.Element {
  switch (block.kind) {
    case 'heading':
      return (
        <Box marginTop={block.level <= 2 ? 1 : 0}>
          <Text bold color={block.level <= 2 ? theme.ui.brand : theme.ui.accent}>
            <InlineSpans spans={block.spans} theme={theme} />
          </Text>
        </Box>
      );

    case 'list-item':
      return (
        <Box paddingLeft={block.depth * 2}>
          <Text color={theme.ui.accent}>
            {block.ordered ? `${block.marker} ` : `${GLYPHS.bullet} `}
          </Text>
          <Text wrap="wrap">
            <InlineSpans spans={block.spans} theme={theme} />
          </Text>
        </Box>
      );

    case 'quote':
      return (
        <Box>
          <Text color={theme.ui.dimmed}>{`${GLYPHS.gutter} `}</Text>
          <Text color={theme.ui.muted} italic wrap="wrap">
            <InlineSpans spans={block.spans} theme={theme} />
          </Text>
        </Box>
      );

    case 'rule':
      return (
        <Box>
          <Text color={theme.ui.borderSubtle}>{GLYPHS.rule.repeat(24)}</Text>
        </Box>
      );

    case 'code':
      return <CodeBlockView block={block} theme={theme} />;

    default:
      return (
        <Box>
          <Text wrap="wrap">
            <InlineSpans spans={block.spans} theme={theme} />
          </Text>
        </Box>
      );
  }
}

/**
 * Renders assistant output as terminal markdown.
 *
 * Assistant turns used to render through a single `<Text wrap="wrap">`, so a
 * reply containing a heading, a bullet list and a fenced code block arrived as
 * one undifferentiated slab with literal `###` and backticks in it. Parsing is
 * streaming-safe (see `lib/markdown.ts`), so this is safe to run on every
 * partial frame.
 */
export function Markdown({
  text,
  streaming = false,
  cursorColor,
}: MarkdownProps): React.JSX.Element | null {
  const theme = useTheme();
  const blocks = useMemo(() => parseMarkdown(text), [text]);

  if (blocks.length === 0) {
    return streaming ? (
      <Text color={cursorColor ?? theme.ui.accent}>{GLYPHS.cursor}</Text>
    ) : null;
  }

  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => (
        <BlockView key={`block-${index}`} block={block} theme={theme} />
      ))}
      {streaming && (
        <Text color={cursorColor ?? theme.ui.accent}>{GLYPHS.cursor}</Text>
      )}
    </Box>
  );
}

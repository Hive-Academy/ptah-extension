/**
 * FilePickerOverlay -- Inline file picker rendered above the MessageInput.
 *
 * TASK_2025_266 Batch 5
 *
 * Displays a filtered list of workspace files based on the @ query.
 * Supports keyboard navigation (Up/Down to select, Enter to confirm, Escape to dismiss).
 * Uses inverse text for the selected item, matching the CommandOverlay pattern.
 *
 * This is NOT a modal -- it renders inline within ChatPanel, between
 * MessageList and MessageInput, identical to CommandOverlay.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';
import { Spinner } from '../common/Spinner.js';
import type { FileEntry } from '../../hooks/use-file-picker.js';

/** Maximum number of files to display in the overlay. */
const MAX_VISIBLE_FILES = 15;

/**
 * Map a file extension to a short icon string for display.
 */
function getFileTypeIcon(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex < 0) return '\u00B7'; // middle dot for extensionless files

  const ext = fileName.substring(dotIndex).toLowerCase();
  switch (ext) {
    case '.ts':
      return 'TS';
    case '.tsx':
      return 'TX';
    case '.js':
      return 'JS';
    case '.jsx':
      return 'JX';
    case '.json':
      return '{}';
    case '.md':
      return '#';
    case '.html':
      return '<>';
    case '.css':
    case '.scss':
      return 'CS';
    case '.py':
      return 'PY';
    case '.go':
      return 'GO';
    case '.rs':
      return 'RS';
    default:
      return '\u00B7'; // middle dot
  }
}

interface FilePickerOverlayProps {
  query: string;
  files: FileEntry[];
  loading: boolean;
  onSelect: (file: FileEntry) => void;
  onDismiss: () => void;
  isActive: boolean;
}

function FilePickerOverlayInner({
  query,
  files,
  loading,
  onSelect,
  onDismiss,
  isActive,
}: FilePickerOverlayProps): React.JSX.Element | null {
  const theme = useTheme();

  const visible = files.slice(0, MAX_VISIBLE_FILES);

  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset selection when the file list or query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, files]);

  useInput(
    (_input, key) => {
      if (key.upArrow) {
        setSelectedIndex((prev) =>
          visible.length === 0
            ? 0
            : (prev - 1 + visible.length) % visible.length,
        );
      }

      if (key.downArrow) {
        setSelectedIndex((prev) =>
          visible.length === 0 ? 0 : (prev + 1) % visible.length,
        );
      }

      if (key.return) {
        const selected = visible[selectedIndex];
        if (selected) {
          onSelect(selected);
        }
      }

      if (key.escape) {
        onDismiss();
      }
    },
    { isActive },
  );

  if (!isActive) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.ui.borderActive}
      paddingX={1}
      marginX={0}
    >
      {loading ? (
        <Spinner label="Searching files..." />
      ) : visible.length === 0 ? (
        <Text color={theme.ui.dimmed}>No matching files</Text>
      ) : (
        visible.map((file, index) => {
          const isSelected = index === selectedIndex;
          const icon = getFileTypeIcon(file.fileName);

          return (
            <Box key={file.relativePath} gap={1}>
              <Text dimColor color={theme.ui.dimmed}>
                {icon}
              </Text>
              <Text bold={isSelected} inverse={isSelected}>
                {file.relativePath}
              </Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}

export const FilePickerOverlay = React.memo(FilePickerOverlayInner);

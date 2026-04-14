/**
 * FilePickerOverlay -- Inline file picker rendered above the MessageInput.
 *
 * Displays a filtered list of workspace files based on the @ query. Renders
 * inline within ChatPanel, not as a modal. Uses `useKeyboardNav` for
 * selection handling.
 */

import React, { useEffect } from 'react';
import { Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { Panel, Spinner } from '../atoms/index.js';
import { ListItem } from '../molecules/index.js';
import type { FileEntry } from '../../hooks/use-file-picker.js';

/** Maximum number of files to display in the overlay. */
const MAX_VISIBLE_FILES = 15;

function getFileTypeIcon(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex < 0) return '\u00B7';

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
      return '\u00B7';
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

  const { activeIndex, reset } = useKeyboardNav({
    itemCount: visible.length,
    isActive,
    wrap: true,
    onSelect: (i) => {
      const selected = visible[i];
      if (selected) {
        onSelect(selected);
      }
    },
    onEscape: onDismiss,
  });

  useEffect(() => {
    reset();
  }, [query, files, reset]);

  if (!isActive) return null;

  return (
    <Panel isActive padding={1}>
      {loading ? (
        <Spinner label="Searching files..." />
      ) : visible.length === 0 ? (
        <Text color={theme.ui.dimmed}>No matching files</Text>
      ) : (
        visible.map((file, index) => (
          <ListItem
            key={file.relativePath}
            label={file.relativePath}
            icon={getFileTypeIcon(file.fileName)}
            isSelected={index === activeIndex}
          />
        ))
      )}
    </Panel>
  );
}

export const FilePickerOverlay = React.memo(FilePickerOverlayInner);

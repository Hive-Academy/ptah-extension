/**
 * Bridges backend `file:pick` requests into the Ink overlay.
 *
 * Subscribes to {@link TuiFilePickerBridge} and exposes the state the chat
 * panel needs to render `FilePickerOverlay` in selection mode. Selection
 * accumulates while `multiple` is set — Enter adds a file, Escape finishes
 * with whatever has been gathered, which is the terminal equivalent of a
 * multi-select dialog's OK/Cancel.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as path from 'path';

import type { PendingFilePick } from '../transport/tui-file-picker-bridge.js';
import type { TuiFilePickerBridge } from '../transport/tui-file-picker-bridge.js';
import type { FileEntry } from './use-file-picker.js';

export interface UseFilePickRequestsResult {
  /** True while the backend is waiting on a selection. */
  readonly active: boolean;
  /** How many files have been gathered so far (multi-select only). */
  readonly selectedCount: number;
  /** Add a file to the selection, settling immediately in single mode. */
  readonly select: (file: FileEntry) => void;
  /** Finish: settle with whatever has been gathered. */
  readonly finish: () => void;
}

export function useFilePickRequests(
  bridge: TuiFilePickerBridge | undefined,
  workspacePath: string,
): UseFilePickRequestsResult {
  const [request, setRequest] = useState<PendingFilePick | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const gathered = useRef<string[]>([]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.subscribe((next) => {
      gathered.current = [];
      setSelectedCount(0);
      setRequest(next);
    });
  }, [bridge]);

  const settle = useCallback((current: PendingFilePick): void => {
    current.resolve(gathered.current);
    gathered.current = [];
    setSelectedCount(0);
    setRequest(null);
  }, []);

  const select = useCallback(
    (file: FileEntry): void => {
      if (!request) return;
      gathered.current.push(path.resolve(workspacePath, file.relativePath));
      if (!request.multiple) {
        settle(request);
        return;
      }
      setSelectedCount(gathered.current.length);
    },
    [request, settle, workspacePath],
  );

  const finish = useCallback((): void => {
    if (!request) return;
    settle(request);
  }, [request, settle]);

  return {
    active: request !== null,
    selectedCount,
    select,
    finish,
  };
}

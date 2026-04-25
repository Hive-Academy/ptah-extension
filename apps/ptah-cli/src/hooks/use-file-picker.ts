/**
 * useFilePicker -- File search hook with debounced RPC calls.
 *
 * TASK_2025_266 Batch 5
 *
 * Provides workspace file discovery for the @ file picker overlay.
 * On mount, fetches an initial file list via context:getAllFiles and caches it.
 * When searchFiles() is called with a non-empty query, debounces 150ms then
 * calls context:getFileSuggestions for server-side filtering.
 * When the query is empty, returns the cached initial list.
 *
 * Usage:
 *   const { files, searchFiles, loading } = useFilePicker();
 */

import { useState, useEffect, useRef, useCallback } from 'react';

import { useCliContext } from '../context/CliContext.js';

export interface FileEntry {
  relativePath: string;
  fileName: string;
  fileType: string;
}

export interface UseFilePickerResult {
  files: FileEntry[];
  searchFiles: (query: string) => void;
  loading: boolean;
}

/** Shape of file info returned by context:getAllFiles / context:getFileSuggestions */
interface ContextFileInfo {
  relativePath: string;
  fileName: string;
  fileType: string;
  uri?: string;
  fsPath?: string;
  size?: number;
  lastModified?: number;
  isDirectory?: boolean;
}

/** Shape of the context:getAllFiles RPC response */
interface GetAllFilesResult {
  files?: ContextFileInfo[];
}

/** Shape of the context:getFileSuggestions RPC response */
interface GetFileSuggestionsResult {
  files?: ContextFileInfo[];
}

/** Debounce delay for search queries in milliseconds. */
const SEARCH_DEBOUNCE_MS = 150;

/** Maximum number of files to fetch on initial load. */
const INITIAL_FETCH_LIMIT = 50;

/** Maximum number of files to return from search. */
const SEARCH_RESULT_LIMIT = 20;

/**
 * Map a ContextFileInfo to our simplified FileEntry.
 */
function toFileEntry(file: ContextFileInfo): FileEntry {
  return {
    relativePath: file.relativePath,
    fileName: file.fileName,
    fileType: file.fileType,
  };
}

/**
 * Hook providing workspace file discovery for the @ file picker.
 */
export function useFilePicker(): UseFilePickerResult {
  const { transport } = useCliContext();

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Cached initial file list (fetched once on mount)
  const cachedFilesRef = useRef<FileEntry[]>([]);

  // Debounce timer ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track whether component is still mounted
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Fetch initial file list on mount
  useEffect(() => {
    let cancelled = false;

    const fetchInitialFiles = async (): Promise<void> => {
      setLoading(true);
      try {
        const response = await transport.call<
          { limit: number },
          GetAllFilesResult
        >('context:getAllFiles', { limit: INITIAL_FETCH_LIMIT });

        if (cancelled) return;

        if (response.success && response.data?.files) {
          const entries = response.data.files.map(toFileEntry);
          cachedFilesRef.current = entries;
          setFiles(entries);
        }
      } catch {
        // Gracefully handle -- file list will be empty
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchInitialFiles();

    return () => {
      cancelled = true;
    };
  }, [transport]);

  /**
   * Search files with debouncing. Empty query returns the cached initial list.
   */
  const searchFiles = useCallback(
    (query: string): void => {
      // Clear any pending debounce
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      // Empty query: return cached initial list immediately
      if (!query.trim()) {
        setFiles(cachedFilesRef.current);
        setLoading(false);
        return;
      }

      setLoading(true);

      debounceTimerRef.current = setTimeout(() => {
        const performSearch = async (): Promise<void> => {
          try {
            const response = await transport.call<
              { query: string; limit: number },
              GetFileSuggestionsResult
            >('context:getFileSuggestions', {
              query: query.trim(),
              limit: SEARCH_RESULT_LIMIT,
            });

            if (!mountedRef.current) return;

            if (response.success && response.data?.files) {
              setFiles(response.data.files.map(toFileEntry));
            } else {
              setFiles([]);
            }
          } catch {
            if (mountedRef.current) {
              setFiles([]);
            }
          } finally {
            if (mountedRef.current) {
              setLoading(false);
            }
          }
        };

        void performSearch();
      }, SEARCH_DEBOUNCE_MS);
    },
    [transport],
  );

  return { files, searchFiles, loading };
}

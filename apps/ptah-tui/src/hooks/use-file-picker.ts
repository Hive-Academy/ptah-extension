import { useState, useEffect, useRef, useCallback } from 'react';

import { useTuiContext } from '../context/TuiContext.js';

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

interface GetAllFilesResult {
  files?: ContextFileInfo[];
}

interface GetFileSuggestionsResult {
  files?: ContextFileInfo[];
}

const SEARCH_DEBOUNCE_MS = 150;
const INITIAL_FETCH_LIMIT = 50;
const SEARCH_RESULT_LIMIT = 20;

function toFileEntry(file: ContextFileInfo): FileEntry {
  return {
    relativePath: file.relativePath,
    fileName: file.fileName,
    fileType: file.fileType,
  };
}

export function useFilePicker(): UseFilePickerResult {
  const { transport } = useTuiContext();

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const cachedFilesRef = useRef<FileEntry[]>([]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
        /* leave the file list empty on failure */
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

  const searchFiles = useCallback(
    (query: string): void => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

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

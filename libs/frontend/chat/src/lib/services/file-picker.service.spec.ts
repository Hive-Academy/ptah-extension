/**
 * Unit tests for FilePickerService - searchFiles() relevance sorting
 *
 * Tests the @ trigger autocomplete filtering bug fix (TASK_2025_163):
 * - searchFiles() relevance-based sorting (exact > startsWith > nameContains > type preference > alphabetical)
 * - Empty query returns first 50 files
 * - Directory field is included in search
 * - Result limit enforcement (max 30 results)
 */

import { TestBed } from '@angular/core/testing';
import { FilePickerService, FileSuggestion } from './file-picker.service';
import { ClaudeRpcService } from '@ptah-extension/core';

/**
 * Factory to create FileSuggestion test data
 */
function createFileSuggestion(
  overrides: Partial<FileSuggestion> = {},
): FileSuggestion {
  return {
    path: overrides.path ?? '/workspace/src/test.ts',
    name: overrides.name ?? 'test.ts',
    directory: overrides.directory ?? 'src',
    type: overrides.type ?? 'file',
    extension: overrides.extension ?? '.ts',
    size: overrides.size ?? 1000,
    lastModified: overrides.lastModified ?? Date.now(),
    isImage: overrides.isImage ?? false,
    isText: overrides.isText ?? true,
  };
}

describe('FilePickerService', () => {
  let service: FilePickerService;

  // Mock ClaudeRpcService - only used for fetchWorkspaceFiles, not searchFiles
  const mockRpcService = {
    call: jest.fn().mockResolvedValue({ success: false, data: null }),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        FilePickerService,
        { provide: ClaudeRpcService, useValue: mockRpcService },
      ],
    });
    service = TestBed.inject(FilePickerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ============================================================================
  // EMPTY QUERY BEHAVIOR
  // ============================================================================

  describe('searchFiles() with empty query', () => {
    it('should return first 50 files when query is empty string', () => {
      // Arrange: populate workspace files with 60 items
      const files = Array.from({ length: 60 }, (_, i) =>
        createFileSuggestion({
          path: `/workspace/file-${i}.ts`,
          name: `file-${i}.ts`,
        }),
      );
      // Access private signal to set test data
      (
        service as unknown as {
          _workspaceFiles: { set: (v: FileSuggestion[]) => void };
        }
      )._workspaceFiles.set(files);

      // Act
      const results = service.searchFiles('');

      // Assert
      expect(results.length).toBe(50);
    });

    it('should return first 50 files when query is undefined-ish empty', () => {
      const files = Array.from({ length: 60 }, (_, i) =>
        createFileSuggestion({
          path: `/workspace/file-${i}.ts`,
          name: `file-${i}.ts`,
        }),
      );
      (
        service as unknown as {
          _workspaceFiles: { set: (v: FileSuggestion[]) => void };
        }
      )._workspaceFiles.set(files);

      // Act - empty string (the actual type parameter is string)
      const results = service.searchFiles('');

      // Assert
      expect(results.length).toBe(50);
    });

    it('should return all files when less than 50 exist and query is empty', () => {
      const files = Array.from({ length: 10 }, (_, i) =>
        createFileSuggestion({
          path: `/workspace/file-${i}.ts`,
          name: `file-${i}.ts`,
        }),
      );
      (
        service as unknown as {
          _workspaceFiles: { set: (v: FileSuggestion[]) => void };
        }
      )._workspaceFiles.set(files);

      const results = service.searchFiles('');

      expect(results.length).toBe(10);
    });

    it('should return empty array when no workspace files loaded', () => {
      const results = service.searchFiles('');

      expect(results).toEqual([]);
    });
  });

  // ============================================================================
  // FILTERING - BASIC MATCHING
  // ============================================================================

  describe('searchFiles() filtering', () => {
    const testFiles: FileSuggestion[] = [
      createFileSuggestion({
        path: '/workspace/src/app/portal.component.ts',
        name: 'portal.component.ts',
        directory: 'src/app',
      }),
      createFileSuggestion({
        path: '/workspace/src/services/portal.service.ts',
        name: 'portal.service.ts',
        directory: 'src/services',
      }),
      createFileSuggestion({
        path: '/workspace/.mcp.json',
        name: '.mcp.json',
        directory: '',
      }),
      createFileSuggestion({
        path: '/workspace/.ptah/specs/README.md',
        name: 'README.md',
        directory: 'task-tracking',
      }),
      createFileSuggestion({
        path: '/workspace/src/utils/helper.ts',
        name: 'helper.ts',
        directory: 'src/utils',
      }),
    ];

    beforeEach(() => {
      (
        service as unknown as {
          _workspaceFiles: { set: (v: FileSuggestion[]) => void };
        }
      )._workspaceFiles.set(testFiles);
    });

    it('should filter by name match - only matching files returned', () => {
      const results = service.searchFiles('portal');

      expect(results.length).toBe(2);
      expect(results.every((r) => r.name.includes('portal'))).toBe(true);
    });

    it('should NOT return unrelated files when query is specific', () => {
      const results = service.searchFiles('portal');

      const names = results.map((r) => r.name);
      expect(names).not.toContain('.mcp.json');
      expect(names).not.toContain('README.md');
      expect(names).not.toContain('helper.ts');
    });

    it('should match by directory field', () => {
      const results = service.searchFiles('task-tracking');

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('README.md');
    });

    it('should match by full path', () => {
      const results = service.searchFiles('src/utils');

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('helper.ts');
    });

    it('should be case-insensitive', () => {
      const results = service.searchFiles('PORTAL');

      expect(results.length).toBe(2);
    });

    it('should return empty array when no files match query', () => {
      const results = service.searchFiles('nonexistent');

      expect(results).toEqual([]);
    });
  });

  // ============================================================================
  // RELEVANCE SORTING - TIERED RANKING
  // ============================================================================

  describe('searchFiles() relevance sorting', () => {
    it('should rank exact name match first', () => {
      const files = [
        createFileSuggestion({
          path: '/workspace/src/portal-utils.ts',
          name: 'portal-utils.ts',
          directory: 'src',
        }),
        createFileSuggestion({
          path: '/workspace/src/portal.ts',
          name: 'portal.ts',
          directory: 'src',
        }),
        createFileSuggestion({
          path: '/workspace/src/my-portal.ts',
          name: 'my-portal.ts',
          directory: 'src',
        }),
      ];
      (
        service as unknown as {
          _workspaceFiles: { set: (v: FileSuggestion[]) => void };
        }
      )._workspaceFiles.set(files);

      const results = service.searchFiles('portal.ts');

      // Exact name match should be first
      expect(results[0].name).toBe('portal.ts');
    });

    it('should rank startsWith before contains', () => {
      const files = [
        createFileSuggestion({
          path: '/workspace/src/my-portal.ts',
          name: 'my-portal.ts',
          directory: 'src',
        }),
        createFileSuggestion({
          path: '/workspace/src/portal-utils.ts',
          name: 'portal-utils.ts',
          directory: 'src',
        }),
      ];
      (
        service as unknown as {
          _workspaceFiles: { set: (v: FileSuggestion[]) => void };
        }
      )._workspaceFiles.set(files);

      const results = service.searchFiles('portal');

      // startsWith should come before contains
      expect(results[0].name).toBe('portal-utils.ts');
      expect(results[1].name).toBe('my-portal.ts');
    });

    it('should rank name contains before path-only match', () => {
      const files = [
        createFileSuggestion({
          path: '/workspace/portal-dir/helper.ts',
          name: 'helper.ts',
          directory: 'portal-dir',
        }),
        createFileSuggestion({
          path: '/workspace/src/portal.service.ts',
          name: 'portal.service.ts',
          directory: 'src',
        }),
      ];
      (
        service as unknown as {
          _workspaceFiles: { set: (v: FileSuggestion[]) => void };
        }
      )._workspaceFiles.set(files);

      const results = service.searchFiles('portal');

      // Name contains "portal" should rank before directory-only match
      expect(results[0].name).toBe('portal.service.ts');
      expect(results[1].name).toBe('helper.ts');
    });

    it('should rank text files before image files', () => {
      const files = [
        createFileSuggestion({
          path: '/workspace/src/portal.png',
          name: 'portal.png',
          directory: 'src',
          isText: false,
          isImage: true,
        }),
        createFileSuggestion({
          path: '/workspace/src/portal.ts',
          name: 'portal.ts',
          directory: 'src',
          isText: true,
          isImage: false,
        }),
      ];
      (
        service as unknown as {
          _workspaceFiles: { set: (v: FileSuggestion[]) => void };
        }
      )._workspaceFiles.set(files);

      const results = service.searchFiles('portal');

      // Both start with "portal", so type preference applies
      expect(results[0].name).toBe('portal.ts');
      expect(results[1].name).toBe('portal.png');
    });

    it('should sort alphabetically when all other criteria are equal', () => {
      const files = [
        createFileSuggestion({
          path: '/workspace/src/portal-z.ts',
          name: 'portal-z.ts',
          directory: 'src',
        }),
        createFileSuggestion({
          path: '/workspace/src/portal-a.ts',
          name: 'portal-a.ts',
          directory: 'src',
        }),
        createFileSuggestion({
          path: '/workspace/src/portal-m.ts',
          name: 'portal-m.ts',
          directory: 'src',
        }),
      ];
      (
        service as unknown as {
          _workspaceFiles: { set: (v: FileSuggestion[]) => void };
        }
      )._workspaceFiles.set(files);

      const results = service.searchFiles('portal');

      // All startsWith "portal", same type → alphabetical
      expect(results[0].name).toBe('portal-a.ts');
      expect(results[1].name).toBe('portal-m.ts');
      expect(results[2].name).toBe('portal-z.ts');
    });

    it('should apply full tiered sorting: exact > startsWith > nameContains > pathOnly', () => {
      const files = [
        createFileSuggestion({
          path: '/workspace/portal-dir/unrelated.ts',
          name: 'unrelated.ts',
          directory: 'portal-dir',
        }),
        createFileSuggestion({
          path: '/workspace/src/my-portal-thing.ts',
          name: 'my-portal-thing.ts',
          directory: 'src',
        }),
        createFileSuggestion({
          path: '/workspace/src/portal.ts',
          name: 'portal.ts',
          directory: 'src',
        }),
        createFileSuggestion({
          path: '/workspace/src/portal-config.ts',
          name: 'portal-config.ts',
          directory: 'src',
        }),
      ];
      (
        service as unknown as {
          _workspaceFiles: { set: (v: FileSuggestion[]) => void };
        }
      )._workspaceFiles.set(files);

      const results = service.searchFiles('portal');

      // Tier 1: Exact name match (none here - "portal" != "portal.ts")
      // But "portal" does match startsWith for portal.ts and portal-config.ts
      // Tier 2: startsWith - portal.ts, portal-config.ts
      // Tier 3: nameContains - my-portal-thing.ts
      // Tier 4: path-only match - unrelated.ts (matched via directory "portal-dir")
      expect(results[0].name).toBe('portal-config.ts');
      expect(results[1].name).toBe('portal.ts');
      // my-portal-thing.ts contains "portal" in name
      expect(results[2].name).toBe('my-portal-thing.ts');
      // unrelated.ts matched via directory "portal-dir"
      expect(results[3].name).toBe('unrelated.ts');
    });
  });

  // ============================================================================
  // RESULT LIMIT ENFORCEMENT
  // ============================================================================

  describe('searchFiles() result limits', () => {
    it('should limit results to 30 when query matches many files', () => {
      // Create 50 files all matching query "component"
      const files = Array.from({ length: 50 }, (_, i) =>
        createFileSuggestion({
          path: `/workspace/src/component-${i}.ts`,
          name: `component-${i}.ts`,
          directory: 'src',
        }),
      );
      (
        service as unknown as {
          _workspaceFiles: { set: (v: FileSuggestion[]) => void };
        }
      )._workspaceFiles.set(files);

      const results = service.searchFiles('component');

      expect(results.length).toBe(30);
    });
  });

  // ============================================================================
  // DIRECTORY SEARCH
  // ============================================================================

  describe('searchFiles() directory search', () => {
    it('should match files by directory name', () => {
      const files = [
        createFileSuggestion({
          path: '/workspace/libs/shared/index.ts',
          name: 'index.ts',
          directory: 'libs/shared',
        }),
        createFileSuggestion({
          path: '/workspace/libs/core/index.ts',
          name: 'index.ts',
          directory: 'libs/core',
        }),
        createFileSuggestion({
          path: '/workspace/apps/main/index.ts',
          name: 'index.ts',
          directory: 'apps/main',
        }),
      ];
      (
        service as unknown as {
          _workspaceFiles: { set: (v: FileSuggestion[]) => void };
        }
      )._workspaceFiles.set(files);

      const results = service.searchFiles('shared');

      expect(results.length).toBe(1);
      expect(results[0].directory).toBe('libs/shared');
    });

    it('should match files by partial directory path', () => {
      const files = [
        createFileSuggestion({
          path: '/workspace/libs/frontend/chat/src/file.ts',
          name: 'file.ts',
          directory: 'libs/frontend/chat/src',
        }),
        createFileSuggestion({
          path: '/workspace/libs/backend/core/src/file.ts',
          name: 'file.ts',
          directory: 'libs/backend/core/src',
        }),
      ];
      (
        service as unknown as {
          _workspaceFiles: { set: (v: FileSuggestion[]) => void };
        }
      )._workspaceFiles.set(files);

      const results = service.searchFiles('frontend');

      expect(results.length).toBe(1);
      expect(results[0].directory).toContain('frontend');
    });
  });

  // ============================================================================
  // REGRESSION TESTS - THE ORIGINAL BUG
  // ============================================================================

  describe('Regression: @ trigger filtering bug (TASK_2025_163)', () => {
    it('should NOT show all files when query is "portal" - only matching ones', () => {
      // This is the exact bug scenario: typing @portal showed .mcp.json, task-tracking, etc.
      const files = [
        createFileSuggestion({
          path: '/workspace/.mcp.json',
          name: '.mcp.json',
          directory: '',
        }),
        createFileSuggestion({
          path: '/workspace/.ptah/specs/README.md',
          name: 'README.md',
          directory: 'task-tracking',
        }),
        createFileSuggestion({
          path: '/workspace/src/portal.component.ts',
          name: 'portal.component.ts',
          directory: 'src',
        }),
        createFileSuggestion({
          path: '/workspace/src/portal.service.ts',
          name: 'portal.service.ts',
          directory: 'src',
        }),
        createFileSuggestion({
          path: '/workspace/package.json',
          name: 'package.json',
          directory: '',
        }),
      ];
      (
        service as unknown as {
          _workspaceFiles: { set: (v: FileSuggestion[]) => void };
        }
      )._workspaceFiles.set(files);

      const results = service.searchFiles('portal');

      // Should ONLY show portal-matching files
      expect(results.length).toBe(2);
      expect(results.every((r) => r.name.includes('portal'))).toBe(true);

      // Should NOT contain unrelated files
      const names = results.map((r) => r.name);
      expect(names).not.toContain('.mcp.json');
      expect(names).not.toContain('README.md');
      expect(names).not.toContain('package.json');
    });

    it('should return relevance-sorted results, not unsorted includes()', () => {
      const files = [
        createFileSuggestion({
          path: '/workspace/src/utils/portal-helper.ts',
          name: 'portal-helper.ts',
          directory: 'src/utils',
        }),
        createFileSuggestion({
          path: '/workspace/src/components/main-portal.ts',
          name: 'main-portal.ts',
          directory: 'src/components',
        }),
        createFileSuggestion({
          path: '/workspace/src/portal.ts',
          name: 'portal.ts',
          directory: 'src',
        }),
      ];
      (
        service as unknown as {
          _workspaceFiles: { set: (v: FileSuggestion[]) => void };
        }
      )._workspaceFiles.set(files);

      const results = service.searchFiles('portal');

      // portal.ts and portal-helper.ts both startWith "portal"
      // main-portal.ts contains "portal" but doesn't start with it
      // Among startsWith, alphabetical: portal-helper.ts before portal.ts
      expect(results[0].name).toBe('portal-helper.ts');
      expect(results[1].name).toBe('portal.ts');
      expect(results[2].name).toBe('main-portal.ts');
    });
  });

  // ============================================================================
  // OTHER SERVICE METHODS
  // ============================================================================

  describe('isFileSupported()', () => {
    it('should recognize TypeScript files as supported', () => {
      expect(service.isFileSupported('test.ts')).toBe(true);
    });

    it('should recognize JavaScript files as supported', () => {
      expect(service.isFileSupported('test.js')).toBe(true);
    });

    it('should recognize image files as supported', () => {
      expect(service.isFileSupported('logo.png')).toBe(true);
    });

    it('should reject unsupported file types', () => {
      expect(service.isFileSupported('archive.zip')).toBe(false);
    });
  });

  describe('getFileTypeIcon()', () => {
    it('should return image icon for image files', () => {
      const file = createFileSuggestion({ isImage: true, isText: false });
      expect(service.getFileTypeIcon(file)).toContain('🖼');
    });

    it('should return document icon for text files', () => {
      const file = createFileSuggestion({ isText: true, isImage: false });
      expect(service.getFileTypeIcon(file)).toContain('📄');
    });
  });
});

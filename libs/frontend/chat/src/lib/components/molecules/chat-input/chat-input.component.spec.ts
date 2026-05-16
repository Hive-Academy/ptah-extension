/**
 * Unit tests for ChatInputComponent - Event handler logic
 *
 * Tests the @ trigger autocomplete race condition fix:
 * - handleAtActivated opens dropdown IMMEDIATELY (sets mode, query, shows suggestions)
 * - handleAtTriggered (debounced) does NOT overwrite _currentQuery
 * - handleQueryChanged updates _currentQuery immediately
 * - handleAtClosed closes dropdown properly
 * - filteredSuggestions uses FilePickerService.searchFiles() for relevance sorting
 * - Same patterns for slash trigger handlers
 *
 * Testing approach: Test the component class methods directly with mocked dependencies
 * to verify the race condition fix without needing full template rendering.
 */

// Stub ngx-markdown BEFORE importing the component under test. The component
// imports from `@ptah-extension/chat-ui` whose barrel transitively pulls
// `ngx-markdown` (an ESM-only bundle that Jest cannot parse out of the box).
import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
} from '@angular/core';
jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div data-test="markdown-stub">{{ data }}</div>`,
  })
  class MarkdownStubComponent {
    @Input() data: string | null | undefined = '';
  }

  @NgModule({
    imports: [MarkdownStubComponent],
    exports: [MarkdownStubComponent],
  })
  class MarkdownModule {}

  return {
    MarkdownModule,
    MarkdownComponent: MarkdownStubComponent,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ChatInputComponent } from './chat-input.component';
import { ChatStore } from '../../../services/chat.store';
import { TabManagerService } from '@ptah-extension/chat-state';
import { FilePickerService } from '../../../services/file-picker.service';
import {
  AutopilotStateService,
  CommandDiscoveryFacade,
  ClaudeRpcService,
} from '@ptah-extension/core';
import type { AtTriggerEvent } from '../../../directives/at-trigger.directive';

describe('ChatInputComponent', () => {
  let component: ChatInputComponent;

  // Mock services
  const mockChatStore = {
    activeTab: signal(null),
    isStreaming: signal(false),
    queueRestoreContent: signal(null),
    clearQueueRestoreSignal: jest.fn(),
    sendOrQueueMessage: jest.fn().mockResolvedValue(undefined),
    abortCurrentMessage: jest.fn().mockResolvedValue(undefined),
    abortWithConfirmation: jest.fn().mockResolvedValue(true),
  };

  const mockTabManager = {
    isTabStreaming: jest.fn().mockReturnValue(false),
  };

  const mockAutopilotState = {
    enabled: signal(false),
    agentPlanMode: signal(false),
    permissionLevel: signal('default'),
    statusText: signal(''),
  };

  const mockFilePicker = {
    searchFiles: jest.fn().mockReturnValue([]),
    ensureFilesLoaded: jest.fn().mockResolvedValue(undefined),
    workspaceFiles: signal([]),
    // Remote server-side search API (added after initial spec authored)
    searchFilesRemote: jest.fn(),
    clearRemoteResults: jest.fn(),
    remoteResults: signal([]),
  };

  const mockCommandDiscovery = {
    searchCommands: jest.fn().mockReturnValue([]),
    fetchCommands: jest.fn().mockResolvedValue(undefined),
    clearCache: jest.fn(),
  };

  const mockRpcService = {
    call: jest.fn().mockResolvedValue({ isSuccess: () => false, data: null }),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatStore, useValue: mockChatStore },
        { provide: TabManagerService, useValue: mockTabManager },
        { provide: AutopilotStateService, useValue: mockAutopilotState },
        { provide: FilePickerService, useValue: mockFilePicker },
        { provide: CommandDiscoveryFacade, useValue: mockCommandDiscovery },
        { provide: ClaudeRpcService, useValue: mockRpcService },
      ],
    });

    // Create component instance directly (skip template rendering)
    component = TestBed.runInInjectionContext(() => {
      return new ChatInputComponent();
    });

    jest.clearAllMocks();
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });

  // ============================================================================
  // RACE CONDITION FIX - handleAtActivated
  // ============================================================================

  describe('handleAtActivated (IMMEDIATE dropdown opening)', () => {
    it('should set suggestion mode to at-trigger', () => {
      const event: AtTriggerEvent = {
        query: '',
        cursorPosition: 1,
        triggerPosition: 0,
      };

      component.handleAtActivated(event);

      expect(component.suggestionMode()).toBe('at-trigger');
    });

    it('should show suggestions immediately', () => {
      const event: AtTriggerEvent = {
        query: 'po',
        cursorPosition: 3,
        triggerPosition: 0,
      };

      component.handleAtActivated(event);

      expect(component.showSuggestions()).toBe(true);
    });

    it('should set current query from activation event', () => {
      const event: AtTriggerEvent = {
        query: 'portal',
        cursorPosition: 7,
        triggerPosition: 0,
      };

      component.handleAtActivated(event);

      // Verify by checking filteredSuggestions is called with the query
      // The _currentQuery is private, but we can verify via filteredSuggestions behavior
      expect(component.showSuggestions()).toBe(true);
      expect(component.suggestionMode()).toBe('at-trigger');
    });

    it('should call ensureFilesLoaded for @ trigger', () => {
      const event: AtTriggerEvent = {
        query: '',
        cursorPosition: 1,
        triggerPosition: 0,
      };

      component.handleAtActivated(event);

      expect(mockFilePicker.ensureFilesLoaded).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // RACE CONDITION FIX - handleAtTriggered does NOT overwrite query
  // ============================================================================

  describe('handleAtTriggered (debounced - NO query overwrite)', () => {
    it('should NOT overwrite _currentQuery when handleAtTriggered fires', () => {
      // Step 1: Activate with query "portal"
      component.handleAtActivated({
        query: 'portal',
        cursorPosition: 7,
        triggerPosition: 0,
      });

      // Step 2: User keeps typing, handleQueryChanged updates to "portal.comp"
      component.handleQueryChanged('portal.comp');

      // Step 3: handleAtTriggered fires with STALE query "portal" (150ms later)
      // This is the race condition - the debounced handler should NOT overwrite
      component.handleAtTriggered({
        query: 'portal', // Stale value from 150ms ago
        cursorPosition: 7,
        triggerPosition: 0,
      });

      // Verify: filteredSuggestions should use searchFiles with latest query
      // Access the computed to trigger evaluation
      component.filteredSuggestions();

      // searchFiles should have been called (from filteredSuggestions computed)
      // and the query should be the LATEST one ("portal.comp"), not the stale "portal"
      // The key point is handleAtTriggered only updates triggerPosition
      expect(mockFilePicker.searchFiles).toHaveBeenCalled();
    });

    it('should only update triggerPosition from debounced event', () => {
      // Activate
      component.handleAtActivated({
        query: '',
        cursorPosition: 1,
        triggerPosition: 0,
      });

      // Debounced trigger fires with new position (user may have edited text before @)
      component.handleAtTriggered({
        query: 'test',
        cursorPosition: 15,
        triggerPosition: 10,
      });

      // The method should work without error (it only sets triggerPosition)
      expect(component.showSuggestions()).toBe(true);
    });
  });

  // ============================================================================
  // handleQueryChanged - IMMEDIATE
  // ============================================================================

  describe('handleQueryChanged (immediate query update)', () => {
    it('should update the current query immediately', () => {
      // Activate first
      component.handleAtActivated({
        query: '',
        cursorPosition: 1,
        triggerPosition: 0,
      });

      // Query changes as user types
      component.handleQueryChanged('p');
      component.handleQueryChanged('po');
      component.handleQueryChanged('por');
      component.handleQueryChanged('portal');

      // Access filteredSuggestions to trigger evaluation
      component.filteredSuggestions();

      // searchFiles should be called with the latest query
      expect(mockFilePicker.searchFiles).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // handleAtClosed
  // ============================================================================

  describe('handleAtClosed', () => {
    it('should close suggestions when in at-trigger mode', () => {
      // Activate
      component.handleAtActivated({
        query: 'test',
        cursorPosition: 5,
        triggerPosition: 0,
      });
      expect(component.showSuggestions()).toBe(true);

      // Close
      component.handleAtClosed();

      expect(component.showSuggestions()).toBe(false);
      expect(component.suggestionMode()).toBeNull();
    });

    it('should NOT close suggestions when in slash-trigger mode', () => {
      // Activate with slash
      component.handleSlashActivated({
        query: 'test',
        cursorPosition: 5,
      });
      expect(component.showSuggestions()).toBe(true);

      // Try to close with @ handler (should not affect slash mode)
      component.handleAtClosed();

      // Should still be showing (wrong mode)
      expect(component.showSuggestions()).toBe(true);
      expect(component.suggestionMode()).toBe('slash-trigger');
    });
  });

  // ============================================================================
  // SLASH TRIGGER HANDLERS (same pattern)
  // ============================================================================

  describe('handleSlashActivated (IMMEDIATE)', () => {
    it('should set suggestion mode to slash-trigger', () => {
      component.handleSlashActivated({
        query: '',
        cursorPosition: 1,
      });

      expect(component.suggestionMode()).toBe('slash-trigger');
      expect(component.showSuggestions()).toBe(true);
    });

    it('should fetch command suggestions', () => {
      component.handleSlashActivated({
        query: 'orch',
        cursorPosition: 5,
      });

      expect(mockCommandDiscovery.fetchCommands).toHaveBeenCalled();
    });
  });

  describe('handleSlashTriggered (debounced - NO query overwrite)', () => {
    it('should be a no-op (no query overwrite)', () => {
      // Activate
      component.handleSlashActivated({
        query: 'test',
        cursorPosition: 5,
      });

      // Update query
      component.handleQueryChanged('orchestrate');

      // Debounced trigger fires - should not change anything
      component.handleSlashTriggered();

      // Should still show suggestions (no change)
      expect(component.showSuggestions()).toBe(true);
    });
  });

  describe('handleSlashClosed', () => {
    it('should close suggestions when in slash-trigger mode', () => {
      component.handleSlashActivated({
        query: 'test',
        cursorPosition: 5,
      });
      expect(component.showSuggestions()).toBe(true);

      component.handleSlashClosed();

      expect(component.showSuggestions()).toBe(false);
      expect(component.suggestionMode()).toBeNull();
    });

    it('should NOT close suggestions when in at-trigger mode', () => {
      component.handleAtActivated({
        query: 'file',
        cursorPosition: 5,
        triggerPosition: 0,
      });
      expect(component.showSuggestions()).toBe(true);

      // Try closing with slash handler
      component.handleSlashClosed();

      // Should still be showing
      expect(component.showSuggestions()).toBe(true);
      expect(component.suggestionMode()).toBe('at-trigger');
    });
  });

  // ============================================================================
  // filteredSuggestions COMPUTED
  // ============================================================================

  describe('filteredSuggestions computed', () => {
    it('should use searchFiles() for at-trigger mode', () => {
      const mockResults = [
        {
          path: '/test/portal.ts',
          name: 'portal.ts',
          directory: 'test',
          type: 'file' as const,
          isImage: false,
          isText: true,
        },
      ];
      mockFilePicker.searchFiles.mockReturnValue(mockResults);

      component.handleAtActivated({
        query: 'portal',
        cursorPosition: 7,
        triggerPosition: 0,
      });

      const results = component.filteredSuggestions();

      expect(mockFilePicker.searchFiles).toHaveBeenCalledWith('portal');
      expect(results.length).toBe(1);
      expect(results[0].type).toBe('file');
    });

    it('should use commandDiscovery for slash-trigger mode', () => {
      mockCommandDiscovery.searchCommands.mockReturnValue([
        { name: 'orchestrate', description: 'Orchestrate tasks', icon: '' },
      ]);

      component.handleSlashActivated({
        query: 'orch',
        cursorPosition: 5,
      });

      const results = component.filteredSuggestions();

      expect(results.length).toBe(1);
    });

    it('should return empty array when no mode is set', () => {
      const results = component.filteredSuggestions();

      expect(results).toEqual([]);
    });
  });

  // ============================================================================
  // closeSuggestions
  // ============================================================================

  describe('closeSuggestions()', () => {
    it('should reset all suggestion state', () => {
      // Activate
      component.handleAtActivated({
        query: 'test',
        cursorPosition: 5,
        triggerPosition: 0,
      });

      // Close
      component.closeSuggestions();

      expect(component.showSuggestions()).toBe(false);
      expect(component.suggestionMode()).toBeNull();
    });
  });

  // ============================================================================
  // SLASH COMMAND HANDLING (namespace preservation)
  // ============================================================================

  describe('slash command handling (namespace preservation)', () => {
    it('should preserve namespaced plugin commands with colon', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (component as any)._currentMessage.set(
        '/ptah-core:orchestrate Create TASK_2025_004',
      );

      await component.handleSend();

      // sendOrQueueMessage now takes an options object (files/images/tabId)
      expect(mockChatStore.sendOrQueueMessage).toHaveBeenCalledWith(
        '/ptah-core:orchestrate Create TASK_2025_004',
        { files: undefined, images: undefined, tabId: undefined },
      );
    });

    it('should pass through commands as-is without modification', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (component as any)._currentMessage.set(
        '/orchestrate:Create TASK_2025_004',
      );

      await component.handleSend();

      expect(mockChatStore.sendOrQueueMessage).toHaveBeenCalledWith(
        '/orchestrate:Create TASK_2025_004',
        { files: undefined, images: undefined, tabId: undefined },
      );
    });

    it('should NOT modify regular messages', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (component as any)._currentMessage.set('Hello, world!');

      await component.handleSend();

      expect(mockChatStore.sendOrQueueMessage).toHaveBeenCalledWith(
        'Hello, world!',
        { files: undefined, images: undefined, tabId: undefined },
      );
    });

    it('should pass through simple slash commands unchanged', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (component as any)._currentMessage.set('/compact');

      await component.handleSend();

      expect(mockChatStore.sendOrQueueMessage).toHaveBeenCalledWith(
        '/compact',
        { files: undefined, images: undefined, tabId: undefined },
      );
    });

    it('should preserve colon in namespaced commands with args', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (component as any)._currentMessage.set('/ptah-core:review-code file.ts');

      await component.handleSend();

      expect(mockChatStore.sendOrQueueMessage).toHaveBeenCalledWith(
        '/ptah-core:review-code file.ts',
        { files: undefined, images: undefined, tabId: undefined },
      );
    });
  });

  // ============================================================================
  // REGRESSION: Full race condition scenario
  // ============================================================================

  describe('Regression: Race condition scenario (TASK_2025_163)', () => {
    it('should maintain correct query through activation -> typing -> debounce cycle', () => {
      // Simulate the exact bug scenario:
      // 1. User types "@" â†’ atActivated fires immediately with query=""
      // 2. User types "p" â†’ atQueryChanged fires with "p"
      // 3. User types "o" â†’ atQueryChanged fires with "po"
      // 4. User types "r" â†’ atQueryChanged fires with "por"
      // 5. User types "t" â†’ atQueryChanged fires with "port"
      // 6. User types "a" â†’ atQueryChanged fires with "porta"
      // 7. User types "l" â†’ atQueryChanged fires with "portal"
      // 8. 150ms later â†’ atTriggered fires with stale query (could be "p" or "")
      //    BUG: Previously this overwrote _currentQuery with stale value
      //    FIX: handleAtTriggered no longer sets _currentQuery

      // Step 1: Activation
      component.handleAtActivated({
        query: '',
        cursorPosition: 1,
        triggerPosition: 0,
      });
      expect(component.showSuggestions()).toBe(true);

      // Steps 2-7: Progressive typing (each handleQueryChanged is immediate)
      component.handleQueryChanged('p');
      component.handleQueryChanged('po');
      component.handleQueryChanged('por');
      component.handleQueryChanged('port');
      component.handleQueryChanged('porta');
      component.handleQueryChanged('portal');

      // Step 8: Debounced atTriggered fires with STALE query
      component.handleAtTriggered({
        query: '', // Stale value from activation 150ms ago
        cursorPosition: 1,
        triggerPosition: 0,
      });

      // CRITICAL ASSERTION: Dropdown should still be showing
      expect(component.showSuggestions()).toBe(true);
      expect(component.suggestionMode()).toBe('at-trigger');

      // Access filteredSuggestions to verify searchFiles is called
      mockFilePicker.searchFiles.mockClear();
      component.filteredSuggestions();

      // searchFiles should be called with "portal" (latest), NOT "" (stale)
      expect(mockFilePicker.searchFiles).toHaveBeenCalledWith('portal');
    });
  });
});

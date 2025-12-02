import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ExecutionNodeComponent } from '@ptah-extension/chat';
import { StaticSessionProvider } from '../services/static-session.provider';

/**
 * DemoChatViewComponent - Displays pre-loaded demo chat session
 *
 * Single Responsibility: Render demo chat messages using ExecutionNodeComponent
 *
 * Complexity Level: 2 (Medium - state orchestration, conditional rendering, composition)
 *
 * Architecture Pattern: Container Component
 * - Injects StaticSessionProvider for demo session data
 * - Composes ExecutionNodeComponent from @ptah-extension/chat library
 * - Handles loading/error states with DaisyUI components
 *
 * Key Features:
 * - Signal-based reactivity (all state from StaticSessionProvider signals)
 * - User messages rendered as right-aligned chat bubbles
 * - Assistant messages rendered via ExecutionNodeComponent (execution trees)
 * - Custom gold-accent scrollbar styling
 * - Loading spinner and error alert states
 * - Auto-loads demo session on component init
 *
 * IMPORTANT: This component must NOT import from @ptah-extension/core
 * (VS Code dependencies). It uses only @ptah-extension/chat which is
 * VS Code-agnostic, making it suitable for standalone web deployment.
 *
 * Design Requirements:
 * - Max-height with overflow scroll
 * - Custom scrollbar: thin, gold accent (rgba(212, 175, 55, 0.4))
 * - DaisyUI chat classes for message bubbles
 * - Ptah icon for assistant avatar
 *
 * @example
 * ```typescript
 * <ptah-demo-chat-view />
 * ```
 */
@Component({
  selector: 'ptah-demo-chat-view',
  standalone: true,
  imports: [CommonModule, ExecutionNodeComponent],
  template: `
    <div
      class="demo-chat-container h-full overflow-y-auto p-4 space-y-4"
      style="scrollbar-width: thin; scrollbar-color: rgba(212, 175, 55, 0.4) transparent;"
    >
      @if (provider.isLoading()) {
        <!-- Loading State: DaisyUI spinner -->
        <div class="flex items-center justify-center h-full">
          <div class="loading loading-spinner loading-lg text-secondary"></div>
        </div>
      } @else if (provider.error()) {
        <!-- Error State: DaisyUI alert -->
        <div class="alert alert-error">
          <span>{{ provider.error() }}</span>
        </div>
      } @else {
        <!-- Messages: Iterate through ExecutionChatMessage array -->
        @for (message of provider.messages(); track message.id) {
          @if (message.role === 'user') {
            <!-- User Message: Right-aligned bubble (chat-end) -->
            <div class="chat chat-end">
              <div class="chat-bubble bg-primary text-primary-content">
                {{ message.rawContent }}
              </div>
            </div>
          } @else {
            <!-- Assistant Message: Left-aligned with execution tree -->
            <div class="chat chat-start">
              <!-- Avatar: Ptah icon with secondary accent background -->
              <div class="chat-image avatar">
                <div class="w-10 rounded-full bg-secondary/20 p-2">
                  <img [src]="ptahIconUri" alt="Ptah" />
                </div>
              </div>
              <!-- Message Content: Use ExecutionNodeComponent for rich rendering -->
              <div
                class="chat-bubble bg-base-300 text-base-content w-full max-w-none"
              >
                @if (message.executionTree) {
                  <!-- Execution Tree: Tool calls, agent spawns, thinking blocks -->
                  <ptah-execution-node [node]="message.executionTree" />
                } @else {
                  <!-- Fallback: Plain text if no execution tree (shouldn't happen in demo) -->
                  <div class="prose prose-invert prose-sm">
                    {{ message.rawContent }}
                  </div>
                }
              </div>
            </div>
          }
        }
      }
    </div>
  `,
  styles: [
    `
      /* Host: Full height to enable scrolling */
      :host {
        display: block;
        height: 100%;
      }

      /* Custom Scrollbar: Gold accent, thin style */
      .demo-chat-container::-webkit-scrollbar {
        width: 8px;
      }
      .demo-chat-container::-webkit-scrollbar-track {
        background: transparent;
      }
      .demo-chat-container::-webkit-scrollbar-thumb {
        background: rgba(212, 175, 55, 0.4);
        border-radius: 4px;
      }
      .demo-chat-container::-webkit-scrollbar-thumb:hover {
        background: rgba(212, 175, 55, 0.6);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoChatViewComponent implements OnInit {
  // ============================================================================
  // DEPENDENCIES
  // ============================================================================
  // Pattern: inject() function in class body (modern Angular approach)
  // Evidence: apps/ptah-landing-page/src/app/services/static-session.provider.ts:62

  readonly provider = inject(StaticSessionProvider);

  // ============================================================================
  // STATIC ASSETS
  // ============================================================================
  // Static icon path for Ptah avatar (served from public/assets/)

  readonly ptahIconUri = '/assets/icons/ptah-icon.png';

  // ============================================================================
  // LIFECYCLE HOOKS
  // ============================================================================

  /**
   * OnInit: Load demo session if not already loaded
   *
   * This ensures the demo session data is available when the component renders.
   * If the provider already has messages (e.g., loaded elsewhere), skip loading.
   */
  ngOnInit(): void {
    // Load demo session if not already loaded
    if (
      this.provider.messages().length === 0 &&
      !this.provider.isLoading()
    ) {
      this.provider.loadSession('/assets/demo-sessions/sample.json');
    }
  }
}

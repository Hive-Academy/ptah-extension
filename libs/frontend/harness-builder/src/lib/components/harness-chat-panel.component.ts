/**
 * HarnessChatPanelComponent
 *
 * Embedded AI chat panel for collaborative harness building.
 * Powered by real LLM responses with full configuration awareness.
 * The AI can suggest concrete actions (add agents, create skills, etc.)
 * that can be applied with one click via action chips.
 *
 * Uses DaisyUI chat bubble styling for message display.
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Send,
  Sparkles,
  MessageCircle,
} from 'lucide-angular';
import type {
  HarnessChatAction,
  HarnessSubagentDefinition,
} from '@ptah-extension/shared';
import { HarnessBuilderStateService } from '../services/harness-builder-state.service';
import { HarnessRpcService } from '../services/harness-rpc.service';

@Component({
  selector: 'ptah-harness-chat-panel',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col h-full bg-base-200 rounded-lg">
      <!-- Header -->
      <div class="flex items-center gap-2 px-3 py-2 border-b border-base-300">
        <lucide-angular
          [img]="MessageCircleIcon"
          class="w-4 h-4 text-primary"
          aria-hidden="true"
        />
        <span class="text-xs font-semibold text-base-content/80">
          AI Assistant
        </span>
      </div>

      <!-- Messages area -->
      <div
        class="flex-1 overflow-y-auto px-3 py-2 space-y-3"
        role="log"
        aria-label="Chat messages"
      >
        @if (messages().length === 0) {
          <div
            class="flex flex-col items-center justify-center h-full text-center opacity-50"
          >
            <lucide-angular
              [img]="SparklesIcon"
              class="w-8 h-8 mb-2 text-primary/40"
              aria-hidden="true"
            />
            <p class="text-xs text-base-content/60">
              Ask me anything about building your harness. I can help design
              agents, create skills, configure MCP servers, and more.
            </p>
          </div>
        }

        @for (msg of messages(); track $index) {
          <div
            class="chat"
            [class.chat-end]="msg.role === 'user'"
            [class.chat-start]="msg.role === 'assistant'"
          >
            <div
              class="chat-bubble text-xs whitespace-pre-wrap"
              [class.chat-bubble-primary]="msg.role === 'user'"
              [class.chat-bubble-accent]="msg.role === 'assistant'"
            >
              {{ msg.content }}
            </div>
          </div>
        }

        @if (isSending()) {
          <div class="chat chat-start">
            <div class="chat-bubble chat-bubble-accent text-xs">
              <span class="loading loading-dots loading-xs"></span>
            </div>
          </div>
        }
      </div>

      <!-- Suggested actions -->
      @if (suggestedActions().length > 0) {
        <div class="px-3 py-1 flex flex-wrap gap-1 border-t border-base-300">
          @for (action of suggestedActions(); track action.label) {
            <button
              class="badge badge-outline badge-sm cursor-pointer hover:badge-primary transition-colors"
              (click)="applySuggestedAction(action)"
              [attr.aria-label]="'Apply: ' + action.label"
            >
              {{ action.label }}
            </button>
          }
        </div>
      }

      <!-- Input area -->
      <div class="px-3 py-2 border-t border-base-300">
        <div class="flex gap-2">
          <input
            type="text"
            class="input input-bordered input-xs flex-1"
            placeholder="Ask about this step..."
            [ngModel]="inputText()"
            (ngModelChange)="inputText.set($event)"
            (keydown.enter)="sendMessage()"
            [disabled]="isSending()"
            aria-label="Chat message input"
          />
          <button
            class="btn btn-primary btn-xs btn-square"
            (click)="sendMessage()"
            [disabled]="isSending() || !inputText().trim()"
            aria-label="Send message"
          >
            <lucide-angular
              [img]="SendIcon"
              class="w-3.5 h-3.5"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </div>
  `,
})
export class HarnessChatPanelComponent {
  private readonly state = inject(HarnessBuilderStateService);
  private readonly rpc = inject(HarnessRpcService);

  // Icons
  protected readonly SendIcon = Send;
  protected readonly SparklesIcon = Sparkles;
  protected readonly MessageCircleIcon = MessageCircle;

  // Local state
  public readonly inputText = signal('');
  public readonly isSending = signal(false);
  public readonly suggestedActions = signal<HarnessChatAction[]>([]);

  // Messages for the current step
  public readonly messages = computed(() => this.state.stepChatMessages());

  public async sendMessage(): Promise<void> {
    const text = this.inputText().trim();
    if (!text || this.isSending()) return;

    this.state.addChatMessage({
      role: 'user',
      content: text,
      step: this.state.currentStep(),
    });

    this.inputText.set('');
    this.isSending.set(true);
    this.suggestedActions.set([]);

    try {
      const response = await this.rpc.chat({
        step: this.state.currentStep(),
        message: text,
        context: this.state.config(),
      });

      this.state.addChatMessage({
        role: 'assistant',
        content: response.reply,
        step: this.state.currentStep(),
      });

      if (response.suggestedActions?.length) {
        this.suggestedActions.set(response.suggestedActions);
      }
    } catch (err) {
      this.state.addChatMessage({
        role: 'assistant',
        content: `Sorry, I encountered an error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        step: this.state.currentStep(),
      });
    } finally {
      this.isSending.set(false);
    }
  }

  public applySuggestedAction(action: HarnessChatAction): void {
    switch (action.type) {
      case 'toggle-agent':
        if (action.payload['agentId']) {
          const currentAgents = this.state.config().agents?.enabledAgents ?? {};
          const agentId = action.payload['agentId'] as string;
          const current = currentAgents[agentId];
          this.state.updateAgents({
            enabledAgents: {
              ...currentAgents,
              [agentId]: {
                ...(current ?? { enabled: false }),
                enabled: !current?.enabled,
              },
            },
            harnessSubagents: this.state.config().agents?.harnessSubagents,
          });
        }
        break;

      case 'add-skill':
        if (action.payload['skillId']) {
          const currentSkills =
            this.state.config().skills?.selectedSkills ?? [];
          const skillId = action.payload['skillId'] as string;
          if (!currentSkills.includes(skillId)) {
            this.state.updateSkills({
              selectedSkills: [...currentSkills, skillId],
              createdSkills: this.state.config().skills?.createdSkills ?? [],
            });
          }
        }
        break;

      case 'update-prompt':
        if (action.payload['prompt']) {
          this.state.updatePrompt({
            systemPrompt: action.payload['prompt'] as string,
            enhancedSections:
              this.state.config().prompt?.enhancedSections ?? {},
          });
        }
        break;

      case 'add-mcp-server':
        if (action.payload['name'] && action.payload['url']) {
          const currentServers = this.state.config().mcp?.servers ?? [];
          this.state.updateMcp({
            servers: [
              ...currentServers,
              {
                name: action.payload['name'] as string,
                url: action.payload['url'] as string,
                enabled: true,
              },
            ],
            enabledTools: this.state.config().mcp?.enabledTools ?? {},
          });
        }
        break;

      case 'add-subagent':
        if (action.payload['id'] && action.payload['name']) {
          const subagent: HarnessSubagentDefinition = {
            id: (action.payload['id'] as string) || 'harness-agent',
            name: (action.payload['name'] as string) || 'Harness Agent',
            description: (action.payload['description'] as string) || '',
            role: (action.payload['role'] as string) || '',
            tools: (action.payload['tools'] as string[]) || [],
            executionMode:
              (action.payload[
                'executionMode'
              ] as string as HarnessSubagentDefinition['executionMode']) ||
              'on-demand',
            triggers: action.payload['triggers'] as string[] | undefined,
            instructions: (action.payload['instructions'] as string) || '',
          };
          this.state.addHarnessSubagent(subagent);
        }
        break;

      case 'create-skill':
        if (action.payload['name'] && action.payload['content']) {
          // Add to created skills and trigger creation
          const currentSkills = this.state.config().skills;
          this.state.updateSkills({
            selectedSkills: currentSkills?.selectedSkills ?? [],
            createdSkills: [
              ...(currentSkills?.createdSkills ?? []),
              {
                name: action.payload['name'] as string,
                description: (action.payload['description'] as string) || '',
                content: action.payload['content'] as string,
              },
            ],
          });
          // Also create the skill file via RPC (fire and forget)
          this.rpc
            .createSkill({
              name: action.payload['name'] as string,
              description: (action.payload['description'] as string) || '',
              content: action.payload['content'] as string,
            })
            .catch(() => {
              // Silently handle — the skill is already in state
            });
        }
        break;
    }

    // Add a message noting the action was applied
    this.state.addChatMessage({
      role: 'assistant',
      content: `Applied: ${action.label}`,
      step: this.state.currentStep(),
    });
    this.suggestedActions.set([]);
  }
}

/**
 * PromptPowerUpsComponent - Power-ups configuration for prompt harness
 *
 * TASK_2025_135 Batch 6: Frontend components for prompt harness system
 *
 * Complexity Level: 2 (Medium - some state, filtering logic, RPC integration)
 * Patterns Applied:
 * - Signal-based state management
 * - OnPush change detection
 * - Computed signals for derived state (filtering by category)
 * - Optimistic updates for toggle switches
 *
 * Responsibilities:
 * - Display available power-ups grouped by category
 * - Toggle power-ups on/off with optimistic updates
 * - Show premium lock icons for premium-only power-ups
 * - Import/export configuration (Task 6.5)
 */
import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  Lock,
  ChevronDown,
  ChevronRight,
  Download,
  Upload,
  Zap,
  Code,
  Workflow,
  Server,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  PowerUpInfo,
  PowerUpStateInfo,
  UserPromptSectionInfo,
  PromptHarnessGetConfigResponse,
} from '@ptah-extension/shared';

/**
 * Combined power-up info with enabled state for UI rendering
 */
interface PowerUpWithState extends PowerUpInfo {
  enabled: boolean;
  priority?: number;
}

@Component({
  selector: 'ptah-prompt-power-ups',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './prompt-power-ups.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptPowerUpsComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);

  // Lucide icons
  readonly LockIcon = Lock;
  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronRightIcon = ChevronRight;
  readonly DownloadIcon = Download;
  readonly UploadIcon = Upload;
  readonly ZapIcon = Zap;
  readonly CodeIcon = Code;
  readonly WorkflowIcon = Workflow;
  readonly ServerIcon = Server;

  // State signals
  readonly isLoading = signal(true);
  readonly isPremium = signal(false);
  readonly powerUps = signal<PowerUpWithState[]>([]);
  readonly customSections = signal<UserPromptSectionInfo[]>([]);
  readonly errorMessage = signal<string | null>(null);
  readonly importError = signal<string | null>(null);

  // Collapsed state for categories
  readonly collapsedCategories = signal<Set<string>>(new Set());

  // Computed signals for filtering by category
  readonly investigationPowerUps = computed(() =>
    this.powerUps().filter((p) => p.category === 'investigation')
  );

  readonly codeQualityPowerUps = computed(() =>
    this.powerUps().filter((p) => p.category === 'code-quality')
  );

  readonly workflowPowerUps = computed(() =>
    this.powerUps().filter((p) => p.category === 'workflow')
  );

  readonly mcpPowerUps = computed(() =>
    this.powerUps().filter((p) => p.category === 'mcp')
  );

  // Category display info
  readonly categories = [
    {
      id: 'investigation',
      name: 'Investigation',
      icon: this.ZapIcon,
      getter: this.investigationPowerUps,
    },
    {
      id: 'code-quality',
      name: 'Code Quality',
      icon: this.CodeIcon,
      getter: this.codeQualityPowerUps,
    },
    {
      id: 'workflow',
      name: 'Workflow',
      icon: this.WorkflowIcon,
      getter: this.workflowPowerUps,
    },
    {
      id: 'mcp',
      name: 'MCP Tools',
      icon: this.ServerIcon,
      getter: this.mcpPowerUps,
    },
  ];

  ngOnInit(): void {
    this.loadConfig();
  }

  /**
   * Load power-ups configuration from backend
   */
  async loadConfig(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const result = await this.rpcService.call('promptHarness:getConfig', {});

      if (result.isSuccess() && result.data) {
        const data = result.data as PromptHarnessGetConfigResponse;

        // Convert power-up states array to Map for lookup
        const statesMap = new Map<string, PowerUpStateInfo>(data.powerUpStates);

        // Merge available power-ups with their states
        const powerUpsWithState: PowerUpWithState[] =
          data.availablePowerUps.map((powerUp) => {
            const state = statesMap.get(powerUp.id);
            return {
              ...powerUp,
              enabled: state?.enabled ?? false,
              priority: state?.priority,
            };
          });

        this.powerUps.set(powerUpsWithState);
        this.customSections.set(data.customSections);
        this.isPremium.set(data.isPremium);
      } else {
        this.errorMessage.set(result.error ?? 'Failed to load configuration');
      }
    } catch (error) {
      console.error('[PromptPowerUpsComponent] Failed to load config:', error);
      this.errorMessage.set('Failed to load power-ups configuration');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Toggle a power-up on/off with optimistic update
   */
  async togglePowerUp(powerUpId: string, enabled: boolean): Promise<void> {
    // Optimistic update - immediately update UI
    const currentPowerUps = this.powerUps();
    const updatedPowerUps = currentPowerUps.map((p) =>
      p.id === powerUpId ? { ...p, enabled } : p
    );
    this.powerUps.set(updatedPowerUps);

    // Build the states array for the save call
    const powerUpStates: Array<[string, PowerUpStateInfo]> = updatedPowerUps
      .filter((p) => p.enabled || p.priority !== undefined)
      .map((p) => [
        p.id,
        {
          powerUpId: p.id,
          enabled: p.enabled,
          priority: p.priority,
          lastModified: Date.now(),
        },
      ]);

    try {
      const result = await this.rpcService.call('promptHarness:saveConfig', {
        powerUpStates,
      });

      if (!result.isSuccess()) {
        // Rollback on failure
        this.powerUps.set(currentPowerUps);
        this.errorMessage.set(result.error ?? 'Failed to save configuration');
      }
    } catch (error) {
      console.error(
        '[PromptPowerUpsComponent] Failed to toggle power-up:',
        error
      );
      // Rollback on failure
      this.powerUps.set(currentPowerUps);
      this.errorMessage.set('Failed to save power-up state');
    }
  }

  /**
   * Toggle category collapsed state
   */
  toggleCategory(categoryId: string): void {
    const current = this.collapsedCategories();
    const updated = new Set(current);
    if (updated.has(categoryId)) {
      updated.delete(categoryId);
    } else {
      updated.add(categoryId);
    }
    this.collapsedCategories.set(updated);
  }

  /**
   * Check if a category is collapsed
   */
  isCategoryCollapsed(categoryId: string): boolean {
    return this.collapsedCategories().has(categoryId);
  }

  /**
   * Export configuration to JSON file (Task 6.5)
   */
  async exportConfig(): Promise<void> {
    try {
      const result = await this.rpcService.call(
        'promptHarness:exportConfig',
        {}
      );

      if (result.isSuccess() && result.data) {
        const json = result.data.json;

        // Create blob and trigger download
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ptah-prompt-config.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        this.errorMessage.set(result.error ?? 'Failed to export configuration');
      }
    } catch (error) {
      console.error(
        '[PromptPowerUpsComponent] Failed to export config:',
        error
      );
      this.errorMessage.set('Failed to export configuration');
    }
  }

  /**
   * Import configuration from JSON file (Task 6.5)
   */
  async importConfig(): Promise<void> {
    this.importError.set(null);

    // Create file input and trigger picker
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';

    input.onchange = async (event: Event) => {
      const target = event.target as HTMLInputElement;
      const file = target.files?.[0];

      if (!file) {
        return;
      }

      try {
        const text = await file.text();

        // Validate JSON format before sending
        try {
          JSON.parse(text);
        } catch {
          this.importError.set('Invalid JSON file format');
          return;
        }

        const result = await this.rpcService.call(
          'promptHarness:importConfig',
          {
            json: text,
          }
        );

        if (result.isSuccess()) {
          // Reload configuration after successful import
          await this.loadConfig();
        } else {
          this.importError.set(
            result.error ?? 'Failed to import configuration'
          );
        }
      } catch (error) {
        console.error(
          '[PromptPowerUpsComponent] Failed to import config:',
          error
        );
        this.importError.set('Failed to read configuration file');
      }
    };

    input.click();
  }

  /**
   * Check if power-up can be toggled (available and either not premium or user is premium)
   */
  canTogglePowerUp(powerUp: PowerUpWithState): boolean {
    if (!powerUp.isAvailable) {
      return false;
    }
    if (powerUp.isPremium && !this.isPremium()) {
      return false;
    }
    return true;
  }
}

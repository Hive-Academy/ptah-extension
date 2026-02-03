/**
 * PromptPreviewComponent - Preview assembled prompt with layer breakdown
 *
 * TASK_2025_135 Batch 6: Frontend components for prompt harness system
 *
 * Complexity Level: 2 (Medium - collapsible layers, token display, clipboard)
 * Patterns Applied:
 * - Signal-based state management
 * - OnPush change detection
 * - Collapsible sections with Set tracking
 *
 * Responsibilities:
 * - Display assembled prompt preview
 * - Show total token count
 * - Display warnings (token budget, conflicts)
 * - Collapsible layer sections with content preview
 * - Copy assembled text to clipboard
 */
import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  RefreshCw,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
  Info,
  Layers,
  FileCode,
  User,
  Building,
  Crown,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  PromptHarnessGetPreviewResponse,
  PromptLayerInfo,
  PromptWarningInfo,
  PromptLayerType,
} from '@ptah-extension/shared';

@Component({
  selector: 'ptah-prompt-preview',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './prompt-preview.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptPreviewComponent {
  private readonly rpcService = inject(ClaudeRpcService);

  // Lucide icons
  readonly RefreshCwIcon = RefreshCw;
  readonly CopyIcon = Copy;
  readonly CheckIcon = Check;
  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronRightIcon = ChevronRight;
  readonly AlertTriangleIcon = AlertTriangle;
  readonly AlertCircleIcon = AlertCircle;
  readonly InfoIcon = Info;
  readonly LayersIcon = Layers;
  readonly FileCodeIcon = FileCode;
  readonly UserIcon = User;
  readonly BuildingIcon = Building;
  readonly CrownIcon = Crown;

  // State signals
  readonly isLoading = signal(false);
  readonly previewData = signal<PromptHarnessGetPreviewResponse | null>(null);
  readonly expandedLayers = signal<Set<string>>(new Set());
  readonly errorMessage = signal<string | null>(null);
  readonly copiedToClipboard = signal(false);

  /**
   * Get icon for layer type
   */
  getLayerIcon(type: PromptLayerType): typeof Layers {
    switch (type) {
      case 'base':
        return this.FileCodeIcon;
      case 'project':
        return this.BuildingIcon;
      case 'agent':
        return this.UserIcon;
      case 'user':
        return this.UserIcon;
      case 'premium':
        return this.CrownIcon;
      default:
        return this.LayersIcon;
    }
  }

  /**
   * Get CSS classes for layer type badge
   */
  getLayerBadgeClass(type: PromptLayerType): string {
    switch (type) {
      case 'base':
        return 'badge-neutral';
      case 'project':
        return 'badge-info';
      case 'agent':
        return 'badge-secondary';
      case 'user':
        return 'badge-accent';
      case 'premium':
        return 'badge-primary';
      default:
        return 'badge-ghost';
    }
  }

  /**
   * Get icon for warning severity
   */
  getWarningIcon(severity: string): typeof Info {
    switch (severity) {
      case 'error':
        return this.AlertCircleIcon;
      case 'warning':
        return this.AlertTriangleIcon;
      default:
        return this.InfoIcon;
    }
  }

  /**
   * Get CSS classes for warning severity
   */
  getWarningClass(severity: string): string {
    switch (severity) {
      case 'error':
        return 'alert-error';
      case 'warning':
        return 'alert-warning';
      default:
        return 'alert-info';
    }
  }

  /**
   * Load prompt preview from backend
   */
  async loadPreview(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const result = await this.rpcService.call('promptHarness:getPreview', {});

      if (result.isSuccess() && result.data) {
        this.previewData.set(result.data);
      } else {
        this.errorMessage.set(result.error ?? 'Failed to load preview');
      }
    } catch (error) {
      console.error('[PromptPreviewComponent] Failed to load preview:', error);
      this.errorMessage.set('Failed to load prompt preview');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Toggle layer expansion
   */
  toggleLayer(layerName: string): void {
    const current = this.expandedLayers();
    const updated = new Set(current);
    if (updated.has(layerName)) {
      updated.delete(layerName);
    } else {
      updated.add(layerName);
    }
    this.expandedLayers.set(updated);
  }

  /**
   * Check if a layer is expanded
   */
  isLayerExpanded(layerName: string): boolean {
    return this.expandedLayers().has(layerName);
  }

  /**
   * Copy assembled prompt text to clipboard
   */
  async copyToClipboard(): Promise<void> {
    const data = this.previewData();
    if (!data?.text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(data.text);
      this.copiedToClipboard.set(true);

      // Reset copied state after 2 seconds
      setTimeout(() => {
        this.copiedToClipboard.set(false);
      }, 2000);
    } catch (error) {
      console.error(
        '[PromptPreviewComponent] Failed to copy to clipboard:',
        error
      );
    }
  }

  /**
   * Truncate content for preview (show first N characters)
   */
  truncateContent(content: string, maxLength = 200): string {
    if (content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength) + '...';
  }

  /**
   * Track function for layers
   */
  trackByLayer(index: number, layer: PromptLayerInfo): string {
    return `${layer.name}-${layer.type}`;
  }

  /**
   * Track function for warnings
   */
  trackByWarning(index: number, warning: PromptWarningInfo): string {
    return `${warning.type}-${index}`;
  }
}

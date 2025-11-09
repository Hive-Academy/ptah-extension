import {
  Component,
  input,
  output,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { ProviderInfo, ProviderHealth } from '@ptah-extension/core';

/**
 * Provider Card Component - Display provider information
 *
 * Complexity Level: 1 (Simple)
 * Signals:
 * - Few props (< 5)
 * - No internal state
 * - Single responsibility clear
 *
 * Patterns Applied:
 * - Standalone component (Angular 20+)
 * - Signal-based inputs/outputs (input(), output())
 * - OnPush change detection
 * - Modern control flow (@if, @switch)
 *
 * SOLID Compliance:
 * - Single Responsibility: Display provider info and actions
 * - No complex logic, just presentation
 */
@Component({
  selector: 'ptah-provider-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './provider-card.component.html',
  styleUrls: ['./provider-card.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProviderCardComponent {
  // Signal-based inputs (Angular 20+)
  readonly provider = input.required<ProviderInfo>();
  readonly isCurrent = input<boolean>(false);
  readonly health = input<ProviderHealth | undefined>(undefined);

  // Signal-based outputs (Angular 20+)
  readonly switchToProvider = output<string>();
  readonly setDefaultProvider = output<string>();

  // Computed: Health status display
  readonly healthStatus = computed(() => {
    const h = this.health();
    if (!h) return { label: 'Unknown', class: 'unknown' };

    switch (h.status) {
      case 'available':
        return { label: 'Available', class: 'healthy' };
      case 'unavailable':
        return { label: 'Unavailable', class: 'degraded' };
      case 'error':
        return { label: 'Error', class: 'unhealthy' };
      case 'initializing':
        return { label: 'Initializing', class: 'initializing' };
      case 'disabled':
        return { label: 'Disabled', class: 'disabled' };
      default:
        return { label: 'Unknown', class: 'unknown' };
    }
  });

  // Computed: Capabilities list
  readonly capabilitiesList = computed(() => {
    const caps = this.provider().capabilities;
    const list: string[] = [];

    if (caps.streaming) list.push('Streaming');
    if (caps.functionCalling) list.push('Function Calling');
    if (caps.fileAttachments) list.push('File Attachments');
    if (caps.imageAnalysis) list.push('Image Analysis');

    return list;
  });

  /**
   * Handle switch to this provider
   */
  onSwitch(): void {
    this.switchToProvider.emit(this.provider().id);
  }

  /**
   * Handle set as default provider
   */
  onSetDefault(): void {
    this.setDefaultProvider.emit(this.provider().id);
  }
}

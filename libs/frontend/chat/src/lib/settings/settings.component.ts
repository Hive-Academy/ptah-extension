import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, ArrowLeft } from 'lucide-angular';
import { AuthConfigComponent } from './auth-config.component';
import { AppStateManager } from '@ptah-extension/core';

/**
 * SettingsComponent - Main settings page container
 *
 * Complexity Level: 1 (Simple container with sections layout)
 * Patterns: Signal-based navigation
 *
 * Responsibilities:
 * - Display settings page header with back navigation
 * - Container for settings sections (authentication, model selection, autopilot)
 * - Navigate back to chat view on back button click
 *
 * SOLID Principles:
 * - Single Responsibility: Settings page layout and navigation
 * - Composition: Uses AuthConfigComponent for authentication section
 */
@Component({
  selector: 'ptah-settings',
  standalone: true,
  imports: [AuthConfigComponent, LucideAngularModule],
  templateUrl: './settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent {
  private readonly appState = inject(AppStateManager);

  // Lucide icons
  readonly ArrowLeftIcon = ArrowLeft;

  /**
   * Navigate back to chat view
   */
  backToChat(): void {
    this.appState.setCurrentView('chat');
  }
}

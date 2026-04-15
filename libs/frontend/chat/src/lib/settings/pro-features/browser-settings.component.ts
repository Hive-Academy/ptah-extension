/**
 * BrowserSettingsComponent - Browser automation settings
 *
 * Controls browser-related settings for AI agents (e.g., localhost access).
 * Reads current value from agent:getConfig, saves via agent:setConfig.
 */

import {
  Component,
  inject,
  ChangeDetectionStrategy,
  signal,
  OnInit,
} from '@angular/core';
import { LucideAngularModule, Globe } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';

@Component({
  selector: 'ptah-browser-settings',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="border border-secondary/30 rounded-md bg-secondary/5 mt-3">
      <div class="p-3">
        <div class="flex items-center gap-1.5 mb-2">
          <lucide-angular [img]="GlobeIcon" class="w-4 h-4 text-secondary" />
          <h2 class="text-xs font-medium uppercase tracking-wide">
            Browser Settings
          </h2>
        </div>

        <div
          class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-base-200/50 transition-colors"
        >
          <div class="flex-1 min-w-0">
            <span class="text-xs font-medium">Allow Localhost</span>
            <p class="text-[10px] text-base-content/50">
              Allow browser tools to navigate to localhost URLs (dev servers,
              local APIs). Enables AI agents to access local network services.
            </p>
          </div>
          <input
            type="checkbox"
            class="toggle toggle-xs toggle-primary"
            [checked]="browserAllowLocalhost()"
            (change)="toggleBrowserAllowLocalhost()"
            [disabled]="browserSettingSaving()"
            aria-label="Toggle localhost access for browser tools"
          />
        </div>

        @if (browserSettingSaveSuccess()) {
          <div class="text-[10px] text-success mt-2">
            Browser setting updated.
          </div>
        }
      </div>
    </div>
  `,
})
export class BrowserSettingsComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);

  readonly GlobeIcon = Globe;

  readonly browserAllowLocalhost = signal(false);
  readonly savedBrowserAllowLocalhost = signal(false);
  readonly browserSettingSaving = signal(false);
  readonly browserSettingSaveSuccess = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const result = await this.rpcService.call('agent:getConfig', undefined);
      if (result.isSuccess()) {
        const allowLocalhost = result.data.browserAllowLocalhost ?? false;
        this.browserAllowLocalhost.set(allowLocalhost);
        this.savedBrowserAllowLocalhost.set(allowLocalhost);
      }
    } catch {
      // Use default if load fails
    }
  }

  async toggleBrowserAllowLocalhost(): Promise<void> {
    const newValue = !this.browserAllowLocalhost();
    this.browserAllowLocalhost.set(newValue);
    this.browserSettingSaving.set(true);
    this.browserSettingSaveSuccess.set(false);

    try {
      const result = await this.rpcService.call('agent:setConfig', {
        browserAllowLocalhost: newValue,
      });
      if (result.isSuccess() && result.data?.success !== false) {
        this.savedBrowserAllowLocalhost.set(newValue);
        this.browserSettingSaveSuccess.set(true);
        setTimeout(() => this.browserSettingSaveSuccess.set(false), 2000);
      } else {
        this.browserAllowLocalhost.set(this.savedBrowserAllowLocalhost());
      }
    } catch {
      this.browserAllowLocalhost.set(this.savedBrowserAllowLocalhost());
    } finally {
      this.browserSettingSaving.set(false);
    }
  }
}

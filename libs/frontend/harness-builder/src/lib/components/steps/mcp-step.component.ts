/**
 * McpStepComponent
 *
 * Step 5: MCP server configuration. Lists discovered MCP servers as toggleable
 * cards, provides an "Add Custom Server" form, and per-server tool selection.
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Server,
  Plus,
  X,
  RefreshCw,
} from 'lucide-angular';
import type { McpServerEntry } from '@ptah-extension/shared';
import { HarnessBuilderStateService } from '../../services/harness-builder-state.service';
import { HarnessRpcService } from '../../services/harness-rpc.service';
import { ConfigCardComponent } from '../atoms/config-card.component';

@Component({
  selector: 'ptah-mcp-step',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, ConfigCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-bold flex items-center gap-2">
            <lucide-angular
              [img]="ServerIcon"
              class="w-5 h-5 text-primary"
              aria-hidden="true"
            />
            MCP Servers
          </h2>
          <p class="text-sm text-base-content/60 mt-1">
            Configure Model Context Protocol servers. This step is optional.
          </p>
        </div>
        <button
          class="btn btn-ghost btn-sm gap-1"
          (click)="discoverServers()"
          [disabled]="isDiscovering()"
          aria-label="Refresh MCP server discovery"
        >
          @if (isDiscovering()) {
            <span class="loading loading-spinner loading-sm"></span>
          } @else {
            <lucide-angular
              [img]="RefreshCwIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
          }
          Discover
        </button>
      </div>

      @if (discoverError()) {
        <div class="alert alert-error text-xs">
          <span>{{ discoverError() }}</span>
        </div>
      }

      <!-- Server list -->
      @if (servers().length > 0) {
        <div class="space-y-3">
          @for (server of servers(); track server.name) {
            <ptah-config-card
              [title]="server.name"
              [description]="server.description ?? server.url"
              [enabled]="server.enabled"
              (toggled)="toggleServer(server.name, $event)"
            />
          }
        </div>
      } @else {
        <div class="text-center text-sm text-base-content/50 py-8">
          No MCP servers discovered. Add a custom server or click Discover.
        </div>
      }

      <!-- Add Custom Server -->
      <div class="divider text-xs text-base-content/40">Add Custom Server</div>

      @if (!showAddForm()) {
        <button
          class="btn btn-outline btn-sm w-full gap-2"
          (click)="showAddForm.set(true)"
        >
          <lucide-angular [img]="PlusIcon" class="w-4 h-4" aria-hidden="true" />
          Add Custom MCP Server
        </button>
      } @else {
        <div class="card bg-base-200 p-4 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="font-medium text-sm">New MCP Server</h3>
            <button
              class="btn btn-ghost btn-xs btn-circle"
              (click)="showAddForm.set(false)"
              aria-label="Close add form"
            >
              <lucide-angular
                [img]="XIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
            </button>
          </div>

          <div class="form-control">
            <label class="label py-0" for="server-name">
              <span class="label-text text-xs">Name</span>
            </label>
            <input
              id="server-name"
              type="text"
              class="input input-bordered input-sm"
              placeholder="my-mcp-server"
              [ngModel]="newServerName()"
              (ngModelChange)="newServerName.set($event)"
            />
          </div>

          <div class="form-control">
            <label class="label py-0" for="server-url">
              <span class="label-text text-xs">URL</span>
            </label>
            <input
              id="server-url"
              type="text"
              class="input input-bordered input-sm"
              placeholder="http://localhost:3100"
              [ngModel]="newServerUrl()"
              (ngModelChange)="newServerUrl.set($event)"
            />
          </div>

          <div class="form-control">
            <label class="label py-0" for="server-desc">
              <span class="label-text text-xs">Description (optional)</span>
            </label>
            <input
              id="server-desc"
              type="text"
              class="input input-bordered input-sm"
              placeholder="What this server provides"
              [ngModel]="newServerDescription()"
              (ngModelChange)="newServerDescription.set($event)"
            />
          </div>

          <button
            class="btn btn-primary btn-sm w-full"
            (click)="addCustomServer()"
            [disabled]="!newServerName().trim() || !newServerUrl().trim()"
          >
            Add Server
          </button>
        </div>
      }

      <!-- Summary -->
      <div class="text-xs text-base-content/50 text-right">
        {{ enabledCount() }} of {{ servers().length }} servers enabled
      </div>
    </div>
  `,
})
export class McpStepComponent implements OnInit {
  private readonly state = inject(HarnessBuilderStateService);
  private readonly rpc = inject(HarnessRpcService);

  // Icons
  protected readonly ServerIcon = Server;
  protected readonly PlusIcon = Plus;
  protected readonly XIcon = X;
  protected readonly RefreshCwIcon = RefreshCw;

  // Local state
  public readonly isDiscovering = signal(false);
  public readonly discoverError = signal<string | null>(null);
  public readonly showAddForm = signal(false);
  public readonly newServerName = signal('');
  public readonly newServerUrl = signal('');
  public readonly newServerDescription = signal('');

  public readonly servers = computed(
    () => this.state.config().mcp?.servers ?? [],
  );

  public readonly enabledCount = computed(
    () => this.servers().filter((s) => s.enabled).length,
  );

  public ngOnInit(): void {
    // Auto-discover on first visit if no servers configured
    if (this.servers().length === 0) {
      this.discoverServers();
    }
  }

  public async discoverServers(): Promise<void> {
    if (this.isDiscovering()) return;

    this.isDiscovering.set(true);
    this.discoverError.set(null);

    try {
      const response = await this.rpc.discoverMcp();

      // Merge discovered servers with existing custom servers to avoid losing user-added entries
      const discoveredNames = new Set(response.servers.map((s) => s.name));
      const existingCustomServers = (
        this.state.config().mcp?.servers ?? []
      ).filter((s) => !discoveredNames.has(s.name));
      const mergedServers = [...response.servers, ...existingCustomServers];

      this.state.updateMcp({
        servers: mergedServers,
        enabledTools: this.state.config().mcp?.enabledTools ?? {},
      });
    } catch (err) {
      this.discoverError.set(
        err instanceof Error ? err.message : 'Failed to discover MCP servers',
      );
    } finally {
      this.isDiscovering.set(false);
    }
  }

  public toggleServer(serverName: string, enabled: boolean): void {
    const updated = this.servers().map((s) =>
      s.name === serverName ? { ...s, enabled } : s,
    );
    this.state.updateMcp({
      servers: updated,
      enabledTools: this.state.config().mcp?.enabledTools ?? {},
    });
  }

  public addCustomServer(): void {
    const name = this.newServerName().trim();
    const url = this.newServerUrl().trim();
    if (!name || !url) return;

    // Basic URL validation — only allow http/https protocols
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return;
      }
    } catch {
      return; // Invalid URL
    }

    const newServer: McpServerEntry = {
      name,
      url,
      description: this.newServerDescription().trim() || undefined,
      enabled: true,
    };

    this.state.updateMcp({
      servers: [...this.servers(), newServer],
      enabledTools: this.state.config().mcp?.enabledTools ?? {},
    });

    // Reset form
    this.newServerName.set('');
    this.newServerUrl.set('');
    this.newServerDescription.set('');
    this.showAddForm.set(false);
  }
}

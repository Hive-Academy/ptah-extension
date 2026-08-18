import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { GatewayRegisterDiscordCommandsResult } from '@ptah-extension/shared';

import { GatewayStateService } from '../services/gateway-state.service';

const DISCORD_INVITE_PERMISSIONS = '292057779200';

function describeRegisterError(error: string): string {
  if (error === 'missing-application-id') {
    return 'set & save the Application ID first';
  }
  if (error === 'missing-token') return 'save the bot token first';
  return error;
}

/** One guild that did not get `/ptah`, resolved to a display label. */
interface RegisterFailureLine {
  readonly guildId: string;
  /** Guild name when the picker has seen it, else the raw guild id. */
  readonly label: string;
  readonly error: string;
}

/**
 * Rendered outcome of a Register `/ptah` run.
 *
 * `tone` is 'warning' only for partial failure (`ok: true` with a non-empty
 * `failed` list) — full success and outright failure keep the muted styling
 * they have always had.
 */
interface RegisterFeedback {
  readonly tone: 'muted' | 'warning';
  readonly summary: string;
  readonly failures: readonly RegisterFailureLine[];
}

@Component({
  selector: 'ptah-discord-integration-kit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4" data-testid="gateway-discord-integration">
      <label class="flex flex-col gap-1">
        <span class="text-xs text-base-content-muted"
          >Application (client) ID</span
        >
        <div class="flex items-center gap-2">
          <input
            type="text"
            autocomplete="off"
            class="input input-sm input-bordered w-full font-mono"
            placeholder="e.g. 1512896140939362527"
            data-testid="gateway-discord-appid"
            [value]="discordAppIdValue()"
            (input)="onDiscordAppIdInput($event)"
            aria-label="Discord application id"
          />
          <button
            type="button"
            class="btn btn-sm btn-outline"
            data-testid="gateway-discord-appid-save"
            (click)="onSaveDiscordAppId()"
          >
            Save
          </button>
        </div>
      </label>

      <div class="flex flex-wrap items-center gap-2">
        @if (discordInviteUrl(); as url) {
          <a
            class="btn btn-sm btn-outline"
            [href]="url"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="gateway-discord-invite"
          >
            Add to your server
          </a>
        } @else {
          <span class="text-xs text-base-content-muted">
            Enter the Application ID to generate an invite link.
          </span>
        }
        <button
          type="button"
          class="btn btn-sm btn-outline"
          data-testid="gateway-discord-register"
          [disabled]="registering()"
          (click)="onRegisterDiscordCommands()"
        >
          @if (registering()) {
            Registering&hellip;
          } @else {
            Register /ptah
          }
        </button>
      </div>

      @if (registerFeedback(); as fb) {
        <div class="flex flex-col gap-0.5" role="status" aria-live="polite">
          <span
            class="text-xs"
            [class.text-base-content-muted]="fb.tone === 'muted'"
            [class.text-warning]="fb.tone === 'warning'"
            data-testid="gateway-discord-register-feedback"
            >{{ fb.summary }}</span
          >
          @for (f of fb.failures; track $index) {
            <span
              class="text-xs text-warning"
              [attr.data-testid]="
                'gateway-discord-register-failure-' + f.guildId
              "
              >Failed: {{ f.label }} — {{ f.error }}</span
            >
          }
        </div>
      }

      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-base-content-muted">
            Allowed servers
            <span class="text-base-content-muted">
              — tick to allow; empty = any server the bot is in
            </span>
          </span>
          <button
            type="button"
            class="btn btn-xs btn-ghost"
            data-testid="gateway-discord-guilds-refresh"
            (click)="onRefreshGuilds()"
          >
            Refresh
          </button>
        </div>
        @if (discordGuilds().length === 0) {
          <span class="text-xs text-base-content-muted">
            Start the bot, then Refresh to pick servers by name (or add IDs in
            the allow-list above).
          </span>
        } @else {
          @for (g of discordGuilds(); track g.id) {
            <label
              class="flex items-center gap-2 text-xs"
              [attr.data-testid]="'gateway-discord-guild-' + g.id"
            >
              <input
                type="checkbox"
                class="checkbox checkbox-xs"
                [checked]="isGuildAllowed(g.id)"
                (change)="onToggleGuild(g.id)"
                [attr.aria-label]="'Allow server ' + g.name"
              />
              <span>{{ g.name }}</span>
            </label>
          }
        }
      </div>

      <span class="text-xs text-base-content-muted">
        Invite grants View Channel, Send Messages, Create Public Threads, and
        Send Messages in Threads. Enable the Message Content intent in the
        Developer Portal for free-form replies.
      </span>
    </div>
  `,
})
export class DiscordIntegrationKitComponent {
  private readonly state = inject(GatewayStateService);

  protected readonly discordGuilds = this.state.discordGuilds;

  private readonly discordAppIdDraft = signal<string | null>(null);
  protected readonly registering = signal(false);

  /** Raw result of the last Register `/ptah` run; null before the first run. */
  private readonly registerResult =
    signal<GatewayRegisterDiscordCommandsResult | null>(null);

  /**
   * Guild-id → guild-name lookup from the picker list. Recomputes when the
   * user hits Refresh, so a partial-failure line picks up the friendly name
   * as soon as the guild list arrives.
   */
  private readonly guildNames = computed(
    () => new Map(this.discordGuilds().map((g) => [g.id, g.name] as const)),
  );

  protected readonly registerFeedback = computed<RegisterFeedback | null>(
    () => {
      const result = this.registerResult();
      if (!result) return null;

      if (!result.ok) {
        return {
          tone: 'muted',
          summary: `Registration failed: ${describeRegisterError(result.error)}`,
          failures: [],
        };
      }

      const failed = result.failed ?? [];
      if (failed.length === 0) {
        return {
          tone: 'muted',
          summary: `Registered /ptah on ${result.registered} ${
            result.scope === 'guild' ? 'server(s)' : 'globally'
          }.`,
          failures: [],
        };
      }

      const names = this.guildNames();
      return {
        tone: 'warning',
        summary: `Registered /ptah for ${result.registered} of ${
          result.registered + failed.length
        } servers.`,
        failures: failed.map((f) => ({
          guildId: f.guildId,
          label: names.get(f.guildId) ?? f.guildId,
          error: f.error,
        })),
      };
    },
  );

  protected discordAppIdValue(): string {
    const draft = this.discordAppIdDraft();
    if (draft !== null) return draft;
    return this.state.discordAppId() ?? '';
  }

  protected onDiscordAppIdInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    this.discordAppIdDraft.set(target.value);
  }

  protected async onSaveDiscordAppId(): Promise<void> {
    await this.state.saveDiscordAppId(this.discordAppIdValue().trim());
    this.discordAppIdDraft.set(null);
  }

  protected discordInviteUrl(): string | null {
    const appId = this.discordAppIdValue().trim();
    if (!appId) return null;
    const scope = encodeURIComponent('bot applications.commands');
    return (
      `https://discord.com/api/oauth2/authorize` +
      `?client_id=${encodeURIComponent(appId)}` +
      `&scope=${scope}` +
      `&permissions=${DISCORD_INVITE_PERMISSIONS}`
    );
  }

  protected async onRegisterDiscordCommands(): Promise<void> {
    this.registering.set(true);
    this.registerResult.set(null);
    try {
      this.registerResult.set(await this.state.registerDiscordCommands());
    } finally {
      this.registering.set(false);
    }
  }

  protected isGuildAllowed(id: string): boolean {
    return this.state.allowLists().discord.includes(id);
  }

  protected async onToggleGuild(id: string): Promise<void> {
    const current = this.state.allowLists().discord;
    const next = current.includes(id)
      ? current.filter((g) => g !== id)
      : [...current, id];
    await this.state.saveAllowList('discord', next);
  }

  protected async onRefreshGuilds(): Promise<void> {
    await this.state.loadDiscordGuilds();
  }
}

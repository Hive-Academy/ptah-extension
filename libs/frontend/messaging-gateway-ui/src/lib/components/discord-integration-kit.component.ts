import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';

import { GatewayStateService } from '../services/gateway-state.service';

const DISCORD_INVITE_PERMISSIONS = '292057779200';

function describeRegisterError(error: string): string {
  if (error === 'missing-application-id') {
    return 'set & save the Application ID first';
  }
  if (error === 'missing-token') return 'save the bot token first';
  return error;
}

@Component({
  selector: 'ptah-discord-integration-kit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="mt-3 flex flex-col gap-2 rounded border border-base-300 p-3"
      data-testid="gateway-discord-integration"
    >
      <h4 class="text-xs font-semibold">Discord integration</h4>

      <label class="form-control w-full">
        <span class="label-text text-xs"> Application (client) ID </span>
        <div class="flex items-center gap-2">
          <input
            type="text"
            autocomplete="off"
            class="input input-bordered input-sm w-full font-mono"
            placeholder="e.g. 1512896140939362527"
            data-testid="gateway-discord-appid"
            [value]="discordAppIdValue()"
            (input)="onDiscordAppIdInput($event)"
            aria-label="Discord application id"
          />
          <button
            type="button"
            class="btn btn-outline btn-sm"
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
            class="btn btn-primary btn-sm"
            [href]="url"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="gateway-discord-invite"
          >
            Add to your server
          </a>
        } @else {
          <span class="text-xs text-base-content/50">
            Enter the Application ID to generate an invite link.
          </span>
        }
        <button
          type="button"
          class="btn btn-outline btn-sm"
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
        <span
          class="text-xs text-base-content/70"
          data-testid="gateway-discord-register-feedback"
          >{{ fb }}</span
        >
      }
      <div class="flex flex-col gap-1">
        <div class="flex items-center justify-between">
          <span class="label-text text-xs">
            Allowed servers
            <span class="text-base-content/50">
              — tick to allow; empty = any server the bot is in
            </span>
          </span>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            data-testid="gateway-discord-guilds-refresh"
            (click)="onRefreshGuilds()"
          >
            Refresh
          </button>
        </div>
        @if (discordGuilds().length === 0) {
          <span class="text-xs text-base-content/50">
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

      <span class="text-xs text-base-content/50">
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
  protected readonly registerFeedback = signal<string | null>(null);

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
    this.registerFeedback.set(null);
    try {
      const result = await this.state.registerDiscordCommands();
      this.registerFeedback.set(
        result.ok
          ? `Registered /ptah on ${result.registered} ${
              result.scope === 'guild' ? 'server(s)' : 'globally'
            }.`
          : `Registration failed: ${describeRegisterError(result.error)}`,
      );
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

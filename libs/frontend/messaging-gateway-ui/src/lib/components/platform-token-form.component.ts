import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import type { GatewayPlatformId } from '@ptah-extension/shared';

import { GatewayStateService } from '../services/gateway-state.service';

@Component({
  selector: 'ptah-platform-token-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="mt-3 flex flex-col gap-2" (submit)="onSubmit($event)">
      <label class="form-control w-full">
        <span class="label-text text-xs">Bot token</span>
        <input
          type="password"
          autocomplete="new-password"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          name="bot-token"
          class="input input-bordered input-sm font-mono"
          [placeholder]="tokenPlaceholder()"
          [value]="botToken()"
          (input)="onTokenInput('bot', $event)"
          [attr.aria-label]="label() + ' bot token'"
        />
      </label>

      @if (hasAppToken()) {
        <label class="form-control w-full">
          <span class="label-text text-xs"> App-level token (xapp-...) </span>
          <input
            type="password"
            autocomplete="new-password"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            name="app-token"
            class="input input-bordered input-sm font-mono"
            placeholder="Paste app-level token (xapp-...)"
            [value]="appToken()"
            (input)="onTokenInput('app', $event)"
            [attr.aria-label]="label() + ' app-level token'"
          />
        </label>
      }

      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-base-content/60">
          Tokens are encrypted by the OS keychain and never persisted in the
          renderer.
        </span>
        <button
          type="submit"
          class="btn btn-primary btn-sm"
          [disabled]="submitting() || !canSubmit()"
        >
          @if (submitting()) {
            Saving&hellip;
          } @else {
            Save & start
          }
        </button>
      </div>
    </form>
  `,
})
export class PlatformTokenFormComponent {
  private readonly state = inject(GatewayStateService);

  public readonly platform = input.required<GatewayPlatformId>();
  public readonly label = input.required<string>();
  public readonly tokenPlaceholder = input.required<string>();
  public readonly hasAppToken = input.required<boolean>();

  protected readonly botToken = signal('');
  protected readonly appToken = signal('');
  protected readonly submitting = signal(false);

  protected onTokenInput(kind: 'bot' | 'app', event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    if (kind === 'bot') {
      this.botToken.set(target.value);
    } else {
      this.appToken.set(target.value);
    }
  }

  protected canSubmit(): boolean {
    if (this.botToken().trim().length === 0) return false;
    if (this.hasAppToken() && this.appToken().trim().length === 0) {
      return false;
    }
    return true;
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const bot = this.botToken();
    const app = this.appToken();
    if (bot.trim().length === 0) return;

    this.submitting.set(true);
    try {
      if (this.platform() === 'slack') {
        await this.state.setToken(this.platform(), bot, app);
      } else {
        await this.state.setToken(this.platform(), bot);
      }
    } finally {
      this.botToken.set('');
      this.appToken.set('');
      this.submitting.set(false);
    }
  }
}

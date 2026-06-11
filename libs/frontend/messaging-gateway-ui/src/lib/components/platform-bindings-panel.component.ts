import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import type {
  GatewayBindingDto,
  GatewayPlatformId,
} from '@ptah-extension/shared';

import { GatewayStateService } from '../services/gateway-state.service';

@Component({
  selector: 'ptah-platform-bindings-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (approvalToast(); as msg) {
      <div role="alert" class="alert alert-error">
        <span class="text-sm">{{ msg }}</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          (click)="onDismissApprovalToast()"
        >
          Dismiss
        </button>
      </div>
    }

    <section class="space-y-1.5" aria-label="Pending bindings">
      <h3 class="text-xs font-semibold">Pending requests</h3>
      @if (pending().length === 0) {
        <p
          class="text-xs text-base-content/50"
          data-testid="gateway-binding-empty"
        >
          No pending requests — send <span class="font-mono">/ptah bind</span>
          from your platform to start.
        </p>
      } @else {
        <ul class="divide-y divide-base-300/70">
          @for (b of pending(); track b.id) {
            <li
              data-testid="gateway-pending-binding-row"
              class="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="flex flex-col">
                <span class="font-mono text-xs">{{ b.platform }}</span>
                <span class="text-xs text-base-content/60">
                  Awaiting code from bot — paste the code the bot sent you.
                </span>
              </div>
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  autocomplete="off"
                  data-testid="gateway-approve-code"
                  class="input input-xs input-bordered w-24 font-mono"
                  placeholder="code"
                  [value]="bindingCodeFor(b.id)"
                  (input)="onBindingCodeInput(b.id, $event)"
                  [attr.aria-label]="
                    'Pairing code for ' + b.platform + ' binding'
                  "
                />
                <button
                  type="button"
                  data-testid="gateway-approve-btn"
                  class="btn btn-xs btn-success btn-outline"
                  [disabled]="!bindingCodeFor(b.id)"
                  (click)="onApprove(b)"
                >
                  Approve
                </button>
                <button
                  type="button"
                  class="btn btn-xs btn-ghost hover:text-error"
                  (click)="onReject(b)"
                >
                  Reject
                </button>
                @if (canAllowSender(b)) {
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost"
                    [attr.data-testid]="'gateway-allow-sender-' + b.id"
                    (click)="onAllowSender(b)"
                  >
                    {{ allowSenderLabel(b.platform) }}
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      }
    </section>

    @if (approved().length > 0) {
      <section class="space-y-1.5" aria-label="Approved bindings">
        <h3 class="text-xs font-semibold">Approved</h3>
        <ul class="divide-y divide-base-300/70">
          @for (b of approved(); track b.id) {
            <li class="flex items-center justify-between px-3 py-2">
              <div class="flex flex-col">
                <span class="font-mono text-xs">{{ b.platform }}</span>
                <span class="text-xs text-base-content/60">
                  {{ b.displayName ?? '—' }}
                  @if (b.lastActiveAt) {
                    · last active
                    {{ formatTime(b.lastActiveAt) }}
                  }
                </span>
              </div>
              <div class="flex items-center gap-2">
                @if (canAllowSender(b)) {
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost"
                    [attr.data-testid]="'gateway-allow-sender-' + b.id"
                    (click)="onAllowSender(b)"
                  >
                    {{ allowSenderLabel(b.platform) }}
                  </button>
                }
                <button
                  type="button"
                  class="btn btn-xs btn-ghost hover:text-error"
                  (click)="onRevoke(b)"
                >
                  Revoke
                </button>
              </div>
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class PlatformBindingsPanelComponent {
  private readonly state = inject(GatewayStateService);

  public readonly platform = input.required<GatewayPlatformId>();

  protected readonly pending = computed(() =>
    this.state.pendingBindings().filter((b) => b.platform === this.platform()),
  );

  protected readonly approved = computed(() =>
    this.state.approvedBindings().filter((b) => b.platform === this.platform()),
  );

  private readonly bindingCodes = signal<Record<string, string>>({});
  protected readonly approvalToast = signal<string | null>(null);

  protected bindingCodeFor(bindingId: string): string {
    return this.bindingCodes()[bindingId] ?? '';
  }

  protected onBindingCodeInput(bindingId: string, event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    const value = target.value;
    this.bindingCodes.update((current) => ({ ...current, [bindingId]: value }));
  }

  protected async onApprove(binding: GatewayBindingDto): Promise<void> {
    const code = this.bindingCodes()[binding.id]?.trim();
    if (!code) return;
    const result = await this.state.approveBinding(
      binding.id,
      code,
      binding.platform,
    );
    if (!result.ok) {
      this.bindingCodes.update((current) => {
        const next = { ...current };
        next[binding.id] = '';
        return next;
      });
      this.approvalToast.set(
        result.error === 'invalid-code'
          ? 'Code mismatch — try again'
          : `Approval failed: ${result.error}`,
      );
      return;
    }
    this.approvalToast.set(null);
    this.bindingCodes.update((current) => {
      const next = { ...current };
      delete next[binding.id];
      return next;
    });
  }

  protected onDismissApprovalToast(): void {
    this.approvalToast.set(null);
  }

  protected async onReject(binding: GatewayBindingDto): Promise<void> {
    await this.state.rejectBinding(binding.id, binding.platform);
    this.bindingCodes.update((current) => {
      const next = { ...current };
      delete next[binding.id];
      return next;
    });
  }

  protected async onRevoke(binding: GatewayBindingDto): Promise<void> {
    await this.state.revokeBinding(binding.id, binding.platform);
  }

  protected isSenderAllowed(binding: GatewayBindingDto): boolean {
    const id = binding.allowListId;
    if (!id) return false;
    return this.state.allowLists()[binding.platform].includes(id);
  }

  protected canAllowSender(binding: GatewayBindingDto): boolean {
    return !!binding.allowListId && !this.isSenderAllowed(binding);
  }

  protected allowSenderLabel(platform: GatewayPlatformId): string {
    if (platform === 'discord') return 'Allow this server';
    if (platform === 'slack') return 'Allow this workspace';
    return 'Allow this user';
  }

  protected async onAllowSender(binding: GatewayBindingDto): Promise<void> {
    const id = binding.allowListId;
    if (!id) return;
    const current = this.state.allowLists()[binding.platform];
    if (current.includes(id)) return;
    await this.state.saveAllowList(binding.platform, [...current, id]);
  }

  protected formatTime(epochMs: number | null): string {
    if (epochMs === null || !Number.isFinite(epochMs)) return '—';
    return new Date(epochMs).toLocaleString();
  }
}

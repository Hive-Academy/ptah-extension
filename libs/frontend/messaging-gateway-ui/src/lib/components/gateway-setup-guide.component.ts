import { ChangeDetectionStrategy, Component, output } from '@angular/core';

@Component({
  selector: 'ptah-gateway-setup-guide',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="fixed inset-0 z-40 bg-black/40"
      (click)="closed.emit()"
      aria-hidden="true"
    ></div>
    <aside
      role="dialog"
      aria-modal="true"
      aria-label="Gateway setup guide"
      tabindex="-1"
      (keydown.escape)="closed.emit()"
      class="fixed inset-y-0 right-0 z-50 w-96 max-w-full overflow-y-auto bg-base-100 shadow-xl"
    >
      <div
        class="sticky top-0 flex items-center justify-between border-b border-base-300 bg-base-100 p-4"
      >
        <h2 class="text-base font-semibold">Gateway setup</h2>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          (click)="closed.emit()"
          aria-label="Close gateway setup guide"
        >
          ✕
        </button>
      </div>

      <div class="flex flex-col gap-4 p-4 text-sm">
        <section>
          <h3 class="mb-1 text-sm font-semibold">Overview</h3>
          <p class="text-xs text-base-content/70">
            Configure a bot token per platform, approve the pairing request,
            then chat from the platform.
          </p>
        </section>

        <section>
          <h3 class="mb-1 text-sm font-semibold">Discord setup</h3>
          <ol class="list-decimal space-y-1 pl-5 text-xs text-base-content/70">
            <li>
              Create an app at the Discord Developer Portal and copy the Bot
              token.
            </li>
            <li>
              Invite the bot with the <span class="font-mono">bot</span> and
              <span class="font-mono">applications.commands</span> OAuth2 scopes
              and the "Send Messages" permission.
            </li>
            <li>
              Register the <span class="font-mono">/ptah</span> slash command
              with a required string option named
              <span class="font-mono">prompt</span> (Ptah does not auto-register
              it).
            </li>
            <li>Paste the bot token above and click "Save & start".</li>
            <li>
              Add your server ID to
              <span class="font-mono">gateway.discord.allowedGuildIds</span>
              (an array) in
              <span class="font-mono">~/.ptah/settings.json</span>.
            </li>
            <li>
              Send <span class="font-mono">/ptah</span> once — the bot replies
              with a pairing code; approve it in the Pending bindings section
              below.
            </li>
          </ol>
        </section>

        <section>
          <h3 class="mb-1 text-sm font-semibold">Telegram setup</h3>
          <ol class="list-decimal space-y-1 pl-5 text-xs text-base-content/70">
            <li>
              Create a bot via <span class="font-mono">@BotFather</span> and
              copy the token.
            </li>
            <li>Paste it above and Save & start.</li>
            <li>
              Add allowed user IDs to
              <span class="font-mono">gateway.telegram.allowedUserIds</span>.
            </li>
            <li>Message the bot, then approve the pairing code.</li>
          </ol>
        </section>

        <section>
          <h3 class="mb-1 text-sm font-semibold">Allow-list</h3>
          <p class="text-xs text-base-content/70">
            Allow-list keys live in
            <span class="font-mono">~/.ptah/settings.json</span> under
            <span class="font-mono">gateway.discord.allowedGuildIds</span>,
            <span class="font-mono">gateway.telegram.allowedUserIds</span>,
            <span class="font-mono">gateway.slack.allowedTeamIds</span> (one
            nested array each). If empty, that platform accepts any sender it
            can see — set at least one to lock it down.
          </p>
        </section>

        <section>
          <h3 class="mb-1 text-sm font-semibold">Pairing</h3>
          <p class="text-xs text-base-content/70">
            The first message from a new sender creates a pending binding and a
            6-digit code; the bot sends the code; approve it in "Pending
            bindings" to start chatting.
          </p>
        </section>
      </div>
    </aside>
  `,
})
export class GatewaySetupGuideComponent {
  public readonly closed = output<void>();
}

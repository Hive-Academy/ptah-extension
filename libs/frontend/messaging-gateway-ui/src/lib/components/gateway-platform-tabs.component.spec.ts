import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { GatewayPlatformId } from '@ptah-extension/shared';

import { GatewayPlatformTabsComponent } from './gateway-platform-tabs.component';
import type { PlatformStatus } from '../services/gateway-state.service';

type StatusMap = Record<GatewayPlatformId, PlatformStatus>;

function statusMap(over: Partial<StatusMap> = {}): StatusMap {
  const stopped: PlatformStatus = { state: 'stopped', lastError: null };
  return {
    telegram: stopped,
    discord: stopped,
    slack: stopped,
    ...over,
  };
}

function mount(
  platforms: StatusMap = statusMap(),
  selected: GatewayPlatformId = 'discord',
): {
  fixture: ComponentFixture<GatewayPlatformTabsComponent>;
  emitted: GatewayPlatformId[];
} {
  TestBed.configureTestingModule({
    imports: [GatewayPlatformTabsComponent],
  });
  const fixture = TestBed.createComponent(GatewayPlatformTabsComponent);
  fixture.componentRef.setInput('platforms', platforms);
  fixture.componentRef.setInput('selected', selected);
  const emitted: GatewayPlatformId[] = [];
  fixture.componentInstance.selectedChange.subscribe((id) => emitted.push(id));
  fixture.detectChanges();
  return { fixture, emitted };
}

function tabs(
  fixture: ComponentFixture<GatewayPlatformTabsComponent>,
): HTMLButtonElement[] {
  return Array.from(
    fixture.nativeElement.querySelectorAll('[role="tab"]'),
  ) as HTMLButtonElement[];
}

function keydown(target: HTMLElement, key: string): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

describe('GatewayPlatformTabsComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('rendering', () => {
    it('renders three tiles in Discord / Slack / Telegram order inside a tablist', () => {
      const { fixture } = mount();
      const tablist = fixture.nativeElement.querySelector('[role="tablist"]');
      expect(tablist).not.toBeNull();

      const buttons = tabs(fixture);
      expect(buttons.map((b) => b.id)).toEqual([
        'gateway-tab-discord',
        'gateway-tab-slack',
        'gateway-tab-telegram',
      ]);
      expect(buttons[0]?.textContent).toContain('Discord');
      expect(buttons[1]?.textContent).toContain('Slack');
      expect(buttons[2]?.textContent).toContain('Telegram');
    });

    it('renders a lucide icon per tile', () => {
      const { fixture } = mount();
      for (const button of tabs(fixture)) {
        expect(button.querySelector('lucide-angular')).not.toBeNull();
      }
    });

    it('renders a status chip per tile reflecting the platforms map', () => {
      const { fixture } = mount(
        statusMap({
          discord: { state: 'running', lastError: null },
          slack: { state: 'error', lastError: 'boom' },
        }),
      );

      const discordChip = fixture.nativeElement.querySelector(
        '[data-testid="gateway-tile-status-discord"]',
      ) as HTMLElement;
      const slackChip = fixture.nativeElement.querySelector(
        '[data-testid="gateway-tile-status-slack"]',
      ) as HTMLElement;
      const telegramChip = fixture.nativeElement.querySelector(
        '[data-testid="gateway-tile-status-telegram"]',
      ) as HTMLElement;

      expect(discordChip.textContent?.trim()).toBe('running');
      expect(discordChip.classList).toContain('badge-success');
      expect(slackChip.textContent?.trim()).toBe('error');
      expect(slackChip.classList).toContain('badge-error');
      expect(telegramChip.textContent?.trim()).toBe('stopped');
      expect(telegramChip.classList).toContain('badge-ghost');
    });

    it('reacts when the platforms input changes', () => {
      const { fixture } = mount();
      fixture.componentRef.setInput(
        'platforms',
        statusMap({ telegram: { state: 'running', lastError: null } }),
      );
      fixture.detectChanges();

      const chip = fixture.nativeElement.querySelector(
        '[data-testid="gateway-tile-status-telegram"]',
      ) as HTMLElement;
      expect(chip.textContent?.trim()).toBe('running');
      expect(chip.classList).toContain('badge-success');
    });
  });

  describe('ARIA semantics', () => {
    it('marks only the selected tile aria-selected with roving tabindex', () => {
      const { fixture } = mount(statusMap(), 'slack');
      const buttons = tabs(fixture);

      const selected = buttons.find((b) => b.id === 'gateway-tab-slack');
      expect(selected?.getAttribute('aria-selected')).toBe('true');
      expect(selected?.tabIndex).toBe(0);

      for (const other of buttons.filter((b) => b !== selected)) {
        expect(other.getAttribute('aria-selected')).toBe('false');
        expect(other.tabIndex).toBe(-1);
      }
    });

    it('links each tab to its pane via aria-controls', () => {
      const { fixture } = mount();
      for (const button of tabs(fixture)) {
        const id = button.id.replace('gateway-tab-', '');
        expect(button.getAttribute('aria-controls')).toBe(`gateway-pane-${id}`);
      }
    });
  });

  describe('keyboard semantics', () => {
    it('ArrowRight selects the next tile', () => {
      const { fixture, emitted } = mount(statusMap(), 'discord');
      const discord = tabs(fixture)[0] as HTMLButtonElement;

      keydown(discord, 'ArrowRight');
      expect(emitted).toEqual(['slack']);
    });

    it('ArrowLeft wraps from the first tile to the last', () => {
      const { fixture, emitted } = mount(statusMap(), 'discord');
      const discord = tabs(fixture)[0] as HTMLButtonElement;

      keydown(discord, 'ArrowLeft');
      expect(emitted).toEqual(['telegram']);
    });

    it('ArrowRight wraps from the last tile to the first', () => {
      const { fixture, emitted } = mount(statusMap(), 'telegram');
      const telegram = tabs(fixture)[2] as HTMLButtonElement;

      keydown(telegram, 'ArrowRight');
      expect(emitted).toEqual(['discord']);
    });

    it('Home selects the first tile and End selects the last', () => {
      const { fixture, emitted } = mount(statusMap(), 'slack');
      const slack = tabs(fixture)[1] as HTMLButtonElement;

      keydown(slack, 'Home');
      keydown(slack, 'End');
      expect(emitted).toEqual(['discord', 'telegram']);
    });

    it('Enter and Space select the focused tile', () => {
      const { fixture, emitted } = mount(statusMap(), 'discord');
      const slack = tabs(fixture)[1] as HTMLButtonElement;

      keydown(slack, 'Enter');
      keydown(slack, ' ');
      expect(emitted).toEqual(['slack', 'slack']);
    });

    it('moves DOM focus to the newly selected tile on arrow navigation', () => {
      const { fixture } = mount(statusMap(), 'discord');
      const buttons = tabs(fixture);
      const discord = buttons[0] as HTMLButtonElement;
      discord.focus();

      keydown(discord, 'ArrowRight');
      expect(document.activeElement).toBe(buttons[1]);
    });

    it('ignores unrelated keys', () => {
      const { fixture, emitted } = mount(statusMap(), 'discord');
      const discord = tabs(fixture)[0] as HTMLButtonElement;

      keydown(discord, 'ArrowDown');
      keydown(discord, 'a');
      expect(emitted).toEqual([]);
    });
  });

  describe('pointer selection', () => {
    it('clicking a tile emits selectedChange', () => {
      const { fixture, emitted } = mount(statusMap(), 'discord');
      const telegram = fixture.nativeElement.querySelector(
        '[data-testid="gateway-tile-telegram"]',
      ) as HTMLButtonElement;

      telegram.click();
      expect(emitted).toEqual(['telegram']);
    });
  });
});

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService, SURFACE_ACTIVE } from '@ptah-extension/core';
import { createMockRpcService, rpcSuccess } from '@ptah-extension/core/testing';
import { AgentDeliveryStore, AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { AgentId, type AgentDeliveryReceipt } from '@ptah-extension/shared';
import { SESSION_CARD_ACTIONS } from '../../../tokens/session-context.token';
import { DeliveryStatusComponent } from '../delivery-status/delivery-status.component';
import { laneThreadEntries } from '../../organisms/transcript/lane-thread';
import { LaneThreadRowComponent } from '../../organisms/transcript/lane-thread-row.component';
import { LaneEventRowComponent } from './lane-event-row.component';
import { provideMarkdown } from 'ngx-markdown';
import type { LaneEventRow } from './lane-event-row.types';

const envelope = 'Lane Glm finished: completed (exit code 0) after 26s.\nTask: Read alpha.md.\nDeliverables: none were declared at spawn, so nothing was checked. Read the lane output before you trust this result, and declare "deliverables" next time.\nReports sent by this lane before it ended: 2.\nCLI Session ID: sess-1 — pass it as resume_session_id to continue this lane instead of respawning it.\nNext: read the lane output.';
const row: LaneEventRow = {
  rowKey: 'm1', agentId: 'agent-1', agent: 'Glm', cli: 'ptah-cli', peerLabel: 'peer session', liveLane: false, earlier: [],
  events: [
    { kind: 'report', body: 'First line\nSecond line', timestamp: 1_700_000_000_000, messageId: 'm1', files: ['/tmp/file.txt'], imageCount: 1 },
    { kind: 'report', body: 'Applied fix\nFull explanation', timestamp: 1_700_000_001_000, messageId: 'm2' },
    { kind: 'completed', verdict: 'unverified', body: envelope, timestamp: 1_700_000_002_000, messageId: 'm3' },
  ],
};

describe('LaneEventRowComponent', () => {
  const openLane = jest.fn();
  let rpc: ReturnType<typeof createMockRpcService>;
  beforeEach(() => {
    openLane.mockClear();
    rpc = createMockRpcService();
    TestBed.configureTestingModule({ imports: [LaneEventRowComponent], providers: [
      { provide: AgentMonitorStore, useValue: { agentsById: signal(new Map()) } },
      { provide: ClaudeRpcService, useValue: rpc },
      provideMarkdown(),
      { provide: SURFACE_ACTIVE, useValue: signal(false) },
      { provide: SESSION_CARD_ACTIONS, useValue: { openLane } },
    ] });
  });

  it('renders exactly two collapsed lines with one chip and no raw task or horizontal scroll', () => {
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', row);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('[data-testid="lane-event-chip"]')).toHaveLength(1);
    const chip = element.querySelector('[data-testid="lane-event-chip"]')!;
    expect(chip.textContent).toContain('Completed');
    expect(chip.textContent).not.toContain('unverified');
    expect(chip.classList.contains('text-state-done')).toBe(true);
    expect(chip.getAttribute('title')).toBe('deliverables not checked');
    expect(element.querySelector('[data-testid="lane-event-toggle"]')?.getAttribute('aria-label'))
      .toContain('deliverables not checked');
    expect(chip.querySelector('.sr-only')).toBeNull();
    const second = element.querySelector('[data-testid="lane-event-second-line"]')!;
    expect(second.textContent).toContain('Applied fix');
    expect(second.textContent).toContain('26s · 2 reports');
    expect(second.textContent).toContain('self-reported');
    expect(second.className).toContain('overflow-hidden');
    expect(element.querySelector('[data-testid="lane-event-unverified-caption"]')?.getAttribute('title')).toContain('Sent from another session');
    expect(element.textContent).not.toContain('Read alpha.md');
    expect(element.textContent).not.toContain('peer session');
    expect(element.querySelector('article')?.getAttribute('title')).toContain('peer session');
    expect(element.querySelector('[data-testid="lane-event-body"]')?.hasAttribute('hidden')).toBe(true);
    expect(element.textContent).not.toContain('file.txt');
  });

  it('shows when output may have been lost in a restart only while outputLostAfter is set', () => {
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', row);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="lane-event-output-lost"]')).toBeNull();

    const lostAt = '2026-11-07T12:34:00.000Z';
    fixture.componentRef.setInput('outputLostAfter', lostAt);
    fixture.detectChanges();
    const notice = element.querySelector('[data-testid="lane-event-output-lost"]')!;
    expect(notice.textContent?.replace(/\s+/g, ' ').trim()).toMatch(/^Output after .+ may have been lost in a restart$/);
    expect(notice.querySelector('time')?.getAttribute('datetime')).toBe(lostAt);

    fixture.componentRef.setInput('outputLostAfter', 'not-a-time');
    fixture.detectChanges();
    expect(element.querySelector('[data-testid="lane-event-output-lost"]')).toBeNull();
  });

  it('right aligns an 80-percent lane card at chat text size with a narrow-pane minimum', () => {
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', row);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const card = element.querySelector('article')!;
    expect(card.classList.contains('mx-auto')).toBe(false);
    expect(card.classList.contains('ml-auto')).toBe(true);
    expect(card.classList.contains('w-3/5')).toBe(true);
    expect(card.classList.contains('max-w-[36rem]')).toBe(true);
    expect(card.classList.contains('min-w-[min(100%,20rem)]')).toBe(true);
    expect(card.classList.contains('w-full')).toBe(false);
    expect(card.className).not.toContain('max-w-[min(640px');
    expect(card.classList.contains('px-3')).toBe(true);
    expect(card.classList.contains('py-2')).toBe(true);
    expect(card.classList.contains('text-[13px]')).toBe(true);
    expect(card.classList.contains('text-sm')).toBe(false);
    expect(card.classList.contains('border-l-2')).toBe(true);
    const tone = card.getAttribute('data-tone');
    expect(['run', 'done', 'need', 'err', 'neutral']).toContain(tone);
    if (tone !== 'neutral') expect(card.classList.contains(`border-l-state-${tone}`)).toBe(true);
    const chip = element.querySelector('[data-testid="lane-event-chip"]');
    expect(chip?.classList.contains('rounded-full')).toBe(true);
    expect(chip?.classList.contains('border-current')).toBe(false);
    // The label keeps body-text contrast; the status color stays on the icon and pill.
    expect(chip?.querySelector('[data-testid="lane-event-chip-label"]')?.classList.contains('text-base-content')).toBe(true);
    expect(card.className).not.toContain('hover:shadow');
    const second = element.querySelector('[data-testid="lane-event-second-line"]')!;
    // Line 2 starts under the agent name: chevron 14 + gap 6 + avatar 24 + gap 6.
    expect(second.classList.contains('pl-[50px]')).toBe(true);
    expect(element.querySelector('[data-testid="lane-event-body"]')?.classList.contains('pl-[50px]')).toBe(true);
    expect(second.className).toContain('text-xs');
    expect(second.className).toContain('leading-5');
    expect(second.className).toContain('overflow-hidden');
  });

  it('expands to markdown reports and parsed completion fields without orchestrator text', () => {
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', row);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const toggle = element.querySelector<HTMLButtonElement>('[data-testid="lane-event-toggle"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBeTruthy();
    toggle.click(); fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(element.querySelectorAll('[data-testid="lane-event-body"] markdown')).toHaveLength(2);
    const completion = element.querySelector('[data-testid="lane-event-completion"]')!;
    expect(completion.textContent).toContain('Duration');
    expect(completion.textContent).toContain('deliverables not checked');
    expect(completion.textContent).toContain('Read alpha.md.');
    expect(completion.textContent).toContain('sess-1');
    expect(completion.textContent).not.toMatch(/Next:|resume_session_id|trust this result/);
    expect(element.textContent).toContain('file.txt');
    expect(element.textContent).toContain('1 image');
    expect(element.querySelector('[role="status"]')?.textContent).toContain('lane completed');
  });

  it('sends the final envelope id for Branch and active Rewind', () => {
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', row);
    fixture.componentRef.setInput('isSessionActive', true);
    const branch = jest.fn(); const rewind = jest.fn();
    fixture.componentInstance.branchRequested.subscribe(branch);
    fixture.componentInstance.rewindRequested.subscribe(rewind);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('[data-testid="lane-event-branch"]')!.click();
    element.querySelector<HTMLButtonElement>('[data-testid="lane-event-rewind"]')!.click();
    expect(branch).toHaveBeenCalledWith('m3');
    expect(rewind).toHaveBeenCalledWith('m3');
    fixture.componentRef.setInput('isSessionActive', false); fixture.detectChanges();
    expect(element.querySelector<HTMLButtonElement>('[data-testid="lane-event-rewind"]')!.disabled).toBe(true);
  });

  it('keeps invisible actions in normal flow and non-clickable until hover or focus', () => {
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', row);
    fixture.detectChanges();
    const actions = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="lane-event-actions"]')!;
    for (const name of ['opacity-0', 'pointer-events-none', 'group-hover:pointer-events-auto', 'group-focus-within:pointer-events-auto']) {
      expect(actions.classList.contains(name)).toBe(true);
    }
    expect(actions.classList.contains('pointer-events-auto')).toBe(false);
    expect(actions.classList.contains('absolute')).toBe(false);
    expect(actions.classList.contains('shrink-0')).toBe(true);
  });

  it('shows a no-deliverable completion as incomplete with the warning tone', () => {
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', { ...row, events: [{ ...row.events[2], verdict: 'no-deliverable' }] });
    fixture.detectChanges();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="lane-event-chip"]')!;
    expect(chip.textContent).toContain('Incomplete · no deliverable');
    expect(chip.textContent).not.toContain('Completed');
    expect(chip.classList.contains('text-state-need')).toBe(true);
  });

  it('disables expansion when a single report reveals nothing more', () => {
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', { ...row, events: [{ kind: 'report', body: 'One line', timestamp: 1, messageId: 'single' }] });
    fixture.detectChanges();
    const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="lane-event-toggle"]')!;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBeNull();
    expect(toggle.querySelector(':scope > lucide-angular')).toBeNull();
  });

  it('lets a long single-line report expand so its full text is reachable by keyboard', () => {
    const body = 'alpha.md contains only the heading "# Alpha" and nothing else in the file';
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', { ...row, events: [{ kind: 'report', body, timestamp: 1, messageId: 'long' }] });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const toggle = element.querySelector<HTMLButtonElement>('[data-testid="lane-event-toggle"]');
    expect(toggle?.disabled).toBe(false);
    toggle?.click(); fixture.detectChanges();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(element.querySelectorAll('[data-testid="lane-event-body"] markdown')).toHaveLength(1);
  });

  it('lets a 30-character one-line report expand at the narrow card width', () => {
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', { ...row, events: [{ kind: 'report', body: 'Checked alpha.md: heading only', timestamp: 1, messageId: 'mid' }] });
    fixture.detectChanges();
    const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="lane-event-toggle"]')!;
    expect(toggle.disabled).toBe(false);
  });

  it('has no Open lane action even when the host can open lanes', () => {
    const fixture = TestBed.createComponent(LaneEventRowComponent);
    fixture.componentRef.setInput('row', row);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="lane-event-open"]')).toBeNull();
    expect(element.textContent).not.toContain('Open lane');
    expect(element.querySelector('[data-testid="lane-event-branch"]')).not.toBeNull();
    expect(openLane).not.toHaveBeenCalled();
  });
  describe('parent delivery status', () => {
    const laneId = AgentId.from('11111111-1111-4111-8111-111111111111');
    const laneRow: LaneEventRow = { ...row, agentId: laneId };
    const deliveryId = `lane-delivery:${laneId}:2026-11-07T12:00:00.000Z` as const;
    const notSaved = { agentId: laneId, kind: 'completion' as const, state: 'not-saved' as const, deliveryId,
      createdAt: Date.now() - 5 * 60_000, updatedAt: Date.now() - 5 * 60_000 };

    function render() {
      const fixture = TestBed.createComponent(LaneEventRowComponent);
      fixture.componentRef.setInput('row', laneRow);
      fixture.detectChanges();
      return fixture;
    }

    it('shows no parent signal and no overclaiming label without a delivery push', () => {
      const element = render().nativeElement as HTMLElement;
      expect(element.querySelector('[data-testid="delivery-status"]')).toBeNull();
      expect(element.textContent).not.toContain('Sent to parent');
      expect(element.textContent).not.toContain('Done');
    });

    it('shows a not-saved completion with its age and retries it through agent:retryParentDelivery', async () => {
      const store = TestBed.inject(AgentDeliveryStore);
      store.onParentDelivery(notSaved);
      const fixture = render();
      const element = fixture.nativeElement as HTMLElement;
      const status = element.querySelector('[data-testid="delivery-status"]')!;
      expect(status.textContent).toContain('Completion not delivered — not saved');
      expect(status.querySelector('time')?.textContent).toBe('5m');
      const retry = element.querySelector<HTMLButtonElement>('button[aria-label="Retry completion from Glm to the parent"]');
      expect(retry).not.toBeNull();
      rpc.call.mockResolvedValueOnce(rpcSuccess({ ...notSaved, parentSessionId: 'parent', attempts: 1, state: 'pending' }));
      retry!.click();
      await fixture.whenStable();
      expect(rpc.call).toHaveBeenCalledWith('agent:retryParentDelivery', { deliveryId });
    });

    it('removes the not-saved notice when a removed push follows', () => {
      const store = TestBed.inject(AgentDeliveryStore);
      store.onParentDelivery(notSaved);
      const fixture = render();
      store.onParentDelivery({ ...notSaved, removed: true });
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="delivery-status"]')).toBeNull();
    });

    it('asks for duplicate-risk confirmation before retrying an uncertain parent delivery', async () => {
      const store = TestBed.inject(AgentDeliveryStore);
      store.onParentDelivery({ ...notSaved, state: 'outcome-unknown', everDispatched: true });
      const fixture = render();
      const element = fixture.nativeElement as HTMLElement;
      element.querySelector<HTMLButtonElement>('button[aria-label="Retry completion from Glm to the parent"]')!.click();
      fixture.detectChanges();
      expect(rpc.call).not.toHaveBeenCalledWith('agent:retryParentDelivery', expect.anything());
      const dialog = element.querySelector('[role="alertdialog"]')!;
      expect(dialog.textContent).toContain('Retrying can run it twice');
      rpc.call.mockResolvedValueOnce(rpcSuccess({ ...notSaved, parentSessionId: 'parent', attempts: 2, state: 'sending' }));
      dialog.querySelector<HTMLButtonElement>('button.btn-warning')!.click();
      await fixture.whenStable();
      expect(rpc.call).toHaveBeenCalledWith('agent:retryParentDelivery', { deliveryId, confirmDuplicateRisk: true });
    });

    it('keeps an accepted delivery off the collapsed card and shows it once when expanded', () => {
      const store = TestBed.inject(AgentDeliveryStore);
      store.onParentDelivery({ ...notSaved, state: 'delivered' });
      const fixture = render();
      const element = fixture.nativeElement as HTMLElement;
      expect(element.querySelector('[data-testid="lane-event-parent-delivery"]')).toBeNull();
      element.querySelector<HTMLButtonElement>('[data-testid="lane-event-toggle"]')!.click();
      fixture.detectChanges();
      const statuses = element.querySelectorAll('[data-testid="delivery-status"]');
      expect(statuses).toHaveLength(1);
      expect(statuses[0].textContent).toContain('Accepted by parent session');
    });

    it('cancels a pending parent delivery through agent:cancelParentDelivery', async () => {
      const store = TestBed.inject(AgentDeliveryStore);
      store.onParentDelivery({ ...notSaved, kind: 'report', state: 'pending' });
      const fixture = render();
      const element = fixture.nativeElement as HTMLElement;
      expect(element.textContent).toContain('Waiting for parent');
      rpc.call.mockResolvedValueOnce(rpcSuccess({ ...notSaved, kind: 'report', parentSessionId: 'parent', attempts: 0, state: 'cancelled' }));
      element.querySelector<HTMLButtonElement>('button[aria-label="Cancel report from Glm to the parent"]')!.click();
      await fixture.whenStable();
      expect(rpc.call).toHaveBeenCalledWith('agent:cancelParentDelivery', { deliveryId });
    });
  });

  describe('ack and limit UI', () => {
    const laneId = AgentId.from('11111111-1111-4111-8111-111111111111');
    const laneRow: LaneEventRow = { ...row, agentId: laneId };
    const now = Date.now();

    function makeReceipt(overrides: Partial<AgentDeliveryReceipt> = {}): AgentDeliveryReceipt {
      return {
        id: 'msg-1',
        agentId: laneId,
        sender: 'user',
        delivery: 'queue',
        mode: 'queue-next-turn',
        state: 'settled',
        turnOutcome: 'completed',
        createdAt: now - 5 * 60_000,
        updatedAt: now - 60_000,
        ...overrides,
      };
    }

    function render() {
      const fixture = TestBed.createComponent(LaneEventRowComponent);
      fixture.componentRef.setInput('row', laneRow);
      fixture.detectChanges();
      return fixture;
    }

    it.each([
      ['pending', undefined, 'Awaiting lane ack', 'text-state-need', false],
      ['read', undefined, 'Read by lane', 'text-state-run', true],
      ['acted', undefined, 'Lane reports acted', 'text-state-done', true],
      ['rejected', 'Needs migration first', 'Lane rejected: Needs migration first', 'text-state-err', true],
      ['unavailable', undefined, 'Ack unavailable (no MCP)', 'text-state-need', false],
    ] as const)('renders ack chip with exact label and accessible name for %s', (ackState, ackNote, expectedLabel, toneClass, inThread) => {
      const store = TestBed.inject(AgentDeliveryStore);
      const item = makeReceipt({ ackState, ackNote, ackAt: now - 30_000 });
      store.onMessageReceipt(item);
      const fixture = render();
      const element = fixture.nativeElement as HTMLElement;
      const chip = element.querySelector('[data-testid="lane-event-ack-chip"]')!;
      expect(chip).not.toBeNull();
      expect(chip.textContent?.trim()).toBe(expectedLabel);
      expect(chip.getAttribute('data-ack-state')).toBe(ackState);
      expect(chip.getAttribute('aria-label')).toBe(`Glm lane acknowledgment: ${expectedLabel}`);
      expect(chip.classList.contains(toneClass)).toBe(true);
      if (ackNote) {
        expect(chip.getAttribute('title')).toBe(ackNote);
        expect(chip.querySelector('[data-testid="lane-event-ack-chip-label"]')?.className).toContain('break-words');
      }

      const threadEntries = laneThreadEntries([], [item], 'claude', 'Glm', 'ptah-cli');
      const ackEntry = threadEntries.find((entry) => entry.kind === 'ack');
      if (inThread) {
        expect(ackEntry).toMatchObject({
          id: 'ack:msg-1',
          kind: 'ack',
          sender: 'Glm · ptah-cli',
          body: expectedLabel,
          ackState,
          timestamp: now - 30_000,
        });
      } else {
        expect(ackEntry).toBeUndefined();
      }
    });

    it('shows transport state, turn outcome, and lane ack separately without implying the lane acted from settled', () => {
      const store = TestBed.inject(AgentDeliveryStore);
      store.onMessageReceipt(makeReceipt({ state: 'settled', turnOutcome: 'completed', ackState: 'pending' }));
      const fixture = render();
      const element = fixture.nativeElement as HTMLElement;
      const transport = element.querySelector('[data-testid="lane-event-transport-state"]')!;
      const outcome = element.querySelector('[data-testid="lane-event-turn-outcome"]')!;
      const ackChip = element.querySelector('[data-testid="lane-event-ack-chip"]')!;
      expect(transport.textContent?.trim()).toBe('Delivered to lane');
      expect(outcome.textContent?.trim()).toBe('Turn ended · completed');
      expect(ackChip.textContent?.trim()).toBe('Awaiting lane ack');
      expect(element.querySelector('[data-testid="lane-event-receipt-status"]')?.textContent).not.toContain('acted');
    });

    it('ignores regressive ack pushes while applying newer transport fields', () => {
      const store = TestBed.inject(AgentDeliveryStore);
      const resetAt = now + 25 * 60_000;
      store.onMessageReceipt(
        makeReceipt({
          state: 'blocked-retryable',
          reason: 'lane-at-limit',
          limit: { known: false },
          ackState: 'read',
          ackAt: now - 40_000,
          updatedAt: now - 40_000,
        }),
      );
      const fixture = render();
      const element = fixture.nativeElement as HTMLElement;
      expect(element.querySelector('[data-testid="lane-event-ack-chip"]')?.textContent?.trim()).toBe('Read by lane');
      expect(element.querySelector('[data-testid="lane-event-limit-status"]')?.querySelector('time')).toBeNull();

      store.onMessageReceipt(
        makeReceipt({
          state: 'blocked-retryable',
          reason: 'lane-at-limit',
          limit: { known: true, resetAt },
          ackState: 'pending',
          updatedAt: now - 10_000,
        }),
      );
      fixture.detectChanges();

      const chip = element.querySelector('[data-testid="lane-event-ack-chip"]')!;
      expect(chip.textContent?.trim()).toBe('Read by lane');
      expect(chip.getAttribute('aria-label')).toBe('Glm lane acknowledgment: Read by lane');
      const limitTime = element.querySelector('[data-testid="lane-event-limit-status"] time');
      expect(limitTime).not.toBeNull();
      expect(limitTime?.getAttribute('datetime')).toBe(new Date(resetAt).toISOString());
    });

    it('renders limit reset time in <time> only when known, and a generic lane at limit label when unknown', () => {
      const store = TestBed.inject(AgentDeliveryStore);
      const resetAt = now + 20 * 60_000;
      store.onMessageReceipt(
        makeReceipt({
          id: 'msg-limit',
          state: 'blocked-retryable',
          reason: 'lane-at-limit',
          limit: { known: true, resetAt },
          updatedAt: now - 30_000,
        }),
      );
      const fixture = render();
      const element = fixture.nativeElement as HTMLElement;
      const knownStatus = element.querySelector('[data-testid="lane-event-limit-status"]')!;
      expect(knownStatus.textContent).toContain('Waiting for limit reset');
      const timeEl = knownStatus.querySelector('time');
      expect(timeEl).not.toBeNull();
      expect(timeEl?.getAttribute('datetime')).toBe(new Date(resetAt).toISOString());

      store.onMessageReceipt(
        makeReceipt({
          id: 'msg-limit',
          state: 'blocked-retryable',
          reason: 'lane-at-limit',
          limit: { known: false },
          updatedAt: now,
        }),
      );
      fixture.detectChanges();

      const unknownStatus = element.querySelector('[data-testid="lane-event-limit-status"]')!;
      expect(unknownStatus.textContent?.trim()).toBe('Lane at limit');
      expect(unknownStatus.querySelector('time')).toBeNull();
    });

    it('renders the known limit reset time in a <time> element inside DeliveryStatusComponent and styles ack thread rows', () => {
      const resetAt = now + 30 * 60_000;
      const deliveryFixture = TestBed.createComponent(DeliveryStatusComponent);
      deliveryFixture.componentRef.setInput(
        'receipt',
        makeReceipt({
          id: 'msg-limit-chip',
          state: 'blocked-retryable',
          reason: 'lane-at-limit',
          limit: { known: true, resetAt },
        }),
      );
      deliveryFixture.componentRef.setInput('subject', 'message to Glm');
      deliveryFixture.detectChanges();

      const statusEl = (deliveryFixture.nativeElement as HTMLElement).querySelector('[data-testid="delivery-status"]')!;
      expect(statusEl.textContent).toContain('Waiting for limit reset');
      const timeEl = statusEl.querySelector('time');
      expect(timeEl).not.toBeNull();
      expect(timeEl?.getAttribute('datetime')).toBe(new Date(resetAt).toISOString());

      const rowFixture = TestBed.createComponent(LaneThreadRowComponent);
      rowFixture.componentRef.setInput('entry', {
        id: 'ack:msg-1',
        sender: 'Glm · ptah-cli',
        senderKind: 'this-lane',
        kind: 'ack',
        timestamp: now - 10_000,
        body: 'Lane rejected: Needs migration',
        ackState: 'rejected',
      });
      rowFixture.detectChanges();
      const rowItem = (rowFixture.nativeElement as HTMLElement).querySelector('[role="listitem"]')!;
      expect(rowItem.classList.contains('border-error')).toBe(true);
      expect(rowItem.getAttribute('aria-label')).toContain('acknowledgment');
    });
  });
});

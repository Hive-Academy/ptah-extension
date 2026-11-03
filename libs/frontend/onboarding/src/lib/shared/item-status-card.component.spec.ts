import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ResumableGenerationAgent } from '@ptah-extension/shared';
import {
  ITEM_STATUS_LABELS,
  ItemStatusCardComponent,
} from './item-status-card.component';

const RAW_ERROR =
  'EACCES: permission denied, open /home/me/.ssh/id_rsa at https://internal.example/api';

function agent(
  status: ResumableGenerationAgent['status'],
  overrides: Partial<ResumableGenerationAgent> = {},
): ResumableGenerationAgent {
  return {
    agentId: 'senior-tester',
    filePath: '.claude/agents/senior-tester.md',
    status,
    rejectedSections: 0,
    tailoredSections: 0,
    ...overrides,
  };
}

describe('ItemStatusCardComponent', () => {
  let fixture: ComponentFixture<ItemStatusCardComponent>;

  function render(
    value: ResumableGenerationAgent,
    extras: { attempt?: number | null; budget?: number | null } = {},
  ): HTMLElement {
    TestBed.configureTestingModule({ imports: [ItemStatusCardComponent] });
    fixture = TestBed.createComponent(ItemStatusCardComponent);
    fixture.componentRef.setInput('agent', value);
    if (extras.attempt !== undefined) {
      fixture.componentRef.setInput('attempt', extras.attempt);
    }
    if (extras.budget !== undefined) {
      fixture.componentRef.setInput('budget', extras.budget);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  const statuses = Object.keys(
    ITEM_STATUS_LABELS,
  ) as ResumableGenerationAgent['status'][];

  it.each(statuses)('renders the C-B2 label for %s', (status) => {
    const el = render(agent(status));
    const chip = el.querySelector(
      '[data-testid="item-status-chip"]',
    ) as HTMLElement;
    expect(chip.textContent).toContain(ITEM_STATUS_LABELS[status]);
    expect(chip.querySelector('lucide-angular')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(el.querySelector('[data-testid="item-status-card"]')?.getAttribute('data-status')).toBe(
      status,
    );
  });

  it('never renders the raw error string', () => {
    const el = render(agent('failed', { error: RAW_ERROR }));
    const text = el.textContent ?? '';
    expect(text).toContain('Failed');
    expect(text).toContain('permission denied');
    expect(text).not.toContain('/home/me/.ssh/id_rsa');
    expect(text).not.toContain('https://internal.example/api');
    expect(text).not.toContain(RAW_ERROR);
    expect(
      (el.querySelector('[data-testid="item-status-failure"]') as HTMLElement)
        .textContent,
    ).not.toContain('EACCES');
  });

  it('shows the label only when a failed agent has no error', () => {
    const el = render(agent('failed'));
    expect(el.textContent).toContain('Failed');
    expect(el.querySelector('[data-testid="item-status-failure"]')).toBeNull();
  });

  it('hides the attempt line without a budget', () => {
    const el = render(agent('failed'), { attempt: 2 });
    expect(el.querySelector('[data-testid="item-status-attempt"]')).toBeNull();
    expect(el.textContent).not.toContain('Attempt');
  });

  it('hides the attempt line without an attempt index', () => {
    const el = render(agent('failed'), { budget: 3 });
    expect(el.querySelector('[data-testid="item-status-attempt"]')).toBeNull();
  });

  it('shows Attempt a of b when both values are set', () => {
    const el = render(agent('failed'), { attempt: 2, budget: 3 });
    expect(
      (el.querySelector('[data-testid="item-status-attempt"]') as HTMLElement)
        .textContent,
    ).toContain('Attempt 2 of 3');
  });

  it('emits the agent id from Retry this agent', () => {
    const el = render(agent('failed'));
    const emitted: string[] = [];
    fixture.componentInstance.retry.subscribe((id) => emitted.push(id));
    (
      el.querySelector('[data-testid="item-status-retry"]') as HTMLButtonElement
    ).click();
    expect(emitted).toEqual(['senior-tester']);
  });

  it('keeps the C-B2 Waiting label and omits a Queued detail line', () => {
    const el = render(agent('pending'));
    expect(el.textContent).toContain('Waiting');
    expect(el.textContent).not.toContain('Queued');
    expect(el.querySelector('[data-testid="item-status-detail"]')).toBeNull();
  });

  it('pluralizes the running tailoring line', () => {
    const el = render(agent('running', { tailoredSections: 1 }));
    expect(
      (el.querySelector('[data-testid="item-status-detail"]') as HTMLElement)
        .textContent,
    ).toContain('Tailoring 1 section');
    expect(el.textContent).not.toContain('Tailoring 1 sections');

    fixture.componentRef.setInput(
      'agent',
      agent('running', { tailoredSections: 3 }),
    );
    fixture.detectChanges();
    expect(
      (el.querySelector('[data-testid="item-status-detail"]') as HTMLElement)
        .textContent,
    ).toContain('Tailoring 3 sections');
  });
});

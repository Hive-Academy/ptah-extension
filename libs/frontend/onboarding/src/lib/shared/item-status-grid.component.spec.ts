import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ResumableGenerationAgent } from '@ptah-extension/shared';
import {
  ItemStatusGridComponent,
  type ItemStatusGridRow,
} from './item-status-grid.component';

function agent(
  agentId: string,
  status: ResumableGenerationAgent['status'],
): ResumableGenerationAgent {
  return {
    agentId,
    filePath: `.claude/agents/${agentId}.md`,
    status,
    rejectedSections: 0,
    tailoredSections: 0,
  };
}

describe('ItemStatusGridComponent', () => {
  let fixture: ComponentFixture<ItemStatusGridComponent>;

  function render(items: readonly ItemStatusGridRow[]): HTMLElement {
    TestBed.configureTestingModule({ imports: [ItemStatusGridComponent] });
    fixture = TestBed.createComponent(ItemStatusGridComponent);
    fixture.componentRef.setInput('items', items);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders a card for each item and forwards retry', () => {
    const el = render([
      { agent: agent('backend-developer', 'written') },
      { agent: agent('devops-engineer', 'failed'), attempt: 1, budget: 3 },
    ]);
    const cards = el.querySelectorAll('[data-testid="item-status-card"]');
    expect(cards).toHaveLength(2);
    expect(el.textContent).toContain('backend-developer');
    expect(el.textContent).toContain('Written');
    expect(el.textContent).toContain('devops-engineer');
    expect(el.textContent).toContain('Failed');
    expect(el.textContent).toContain('Attempt 1 of 3');
    expect(el.querySelector('[data-testid="item-status-grid"]')?.getAttribute('aria-label')).toBe(
      'Agent status',
    );

    const emitted: string[] = [];
    fixture.componentInstance.retry.subscribe((id) => emitted.push(id));
    (
      el.querySelector('[data-testid="item-status-retry"]') as HTMLButtonElement
    ).click();
    expect(emitted).toEqual(['devops-engineer']);
  });
});

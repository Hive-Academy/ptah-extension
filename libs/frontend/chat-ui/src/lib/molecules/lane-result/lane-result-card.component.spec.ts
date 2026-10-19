import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FILE_LINK_OPENER } from '@ptah-extension/core';
import {
  parseLaneResult,
  type LaneResult,
} from '../../utils/lane-result.utils';
import { LaneResultCardComponent } from './lane-result-card.component';

const DIR =
  'D:\\projects\\ptah-extension\\.claude-worktrees\\x\\.ptah\\specs\\TASK_2026_593_7c2e';

describe('LaneResultCardComponent', () => {
  let fixture: ComponentFixture<LaneResultCardComponent>;
  let openMock: jest.Mock<Promise<void>, [unknown]>;

  function render(text: string): HTMLElement {
    const result = parseLaneResult(text) as LaneResult;
    fixture.componentRef.setInput('result', result);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function all(host: HTMLElement, testId: string): HTMLElement[] {
    return Array.from(host.querySelectorAll(`[data-testid="${testId}"]`));
  }

  beforeEach(async () => {
    openMock = jest.fn().mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [LaneResultCardComponent],
      providers: [{ provide: FILE_LINK_OPENER, useValue: { open: openMock } }],
    }).compileComponents();
    fixture = TestBed.createComponent(LaneResultCardComponent);
  });

  const SAMPLE = [
    'Reported to the spawning session: Wrote two documents.',
    `WROTE: ${DIR}\\parity-inventory.md — 26 capabilities`,
    `WROTE: ${DIR}\\code-logic-review.md — APPROVED`,
  ].join('\n');

  it('shows the reported note, the count and the shared folder once', () => {
    const host = render(SAMPLE);

    expect(
      host.querySelector('[data-testid="lane-result-reported"]')?.textContent,
    ).toContain('Wrote two documents.');
    expect(
      host
        .querySelector('[data-testid="lane-result-count"]')
        ?.textContent?.trim(),
    ).toBe('Files written · 2');
    const folder = host.querySelector(
      '[data-testid="lane-result-folder"]',
    ) as HTMLElement;
    expect(folder.textContent?.trim()).toBe('TASK_2026_593_7c2e');
    expect(folder.getAttribute('title')).toBe(DIR);
  });

  it('renders one row per file with the exact path in title and a tinted verdict', () => {
    const host = render(SAMPLE);
    const rows = all(host, 'lane-result-file');

    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('title')).toBe(`${DIR}\\parity-inventory.md`);
    expect(
      all(host, 'lane-result-name').map((el) => el.textContent?.trim()),
    ).toEqual(['parity-inventory.md', 'code-logic-review.md']);
    const verdicts = all(host, 'lane-result-verdict');
    expect(verdicts[0].classList).toContain('text-base-content');
    expect(verdicts[1].textContent?.trim()).toBe('APPROVED');
    expect(verdicts[1].classList).toContain('text-success');
    expect(verdicts[1].classList).toContain('rounded-full');
  });

  it('opens a file through FILE_LINK_OPENER with the exact path', () => {
    const host = render(SAMPLE);
    const button = host.querySelector(
      'button[aria-label="Open parity-inventory.md"]',
    ) as HTMLButtonElement;

    expect(button.getAttribute('title')).toBe(`${DIR}\\parity-inventory.md`);
    button.click();
    expect(openMock).toHaveBeenCalledWith({
      path: `${DIR}\\parity-inventory.md`,
      origin: fixture.nativeElement,
    });
  });

  it('omits the note and the folder when there is none to show', () => {
    const host = render('WROTE: /a/one.md\nWROTE: /b/two.md — NEEDS_REVISION');

    expect(host.querySelector('[data-testid="lane-result-reported"]')).toBe(
      null,
    );
    expect(host.querySelector('[data-testid="lane-result-folder"]')).toBe(null);
    const verdicts = all(host, 'lane-result-verdict');
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].classList).toContain('text-warning');
  });
});

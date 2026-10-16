import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { HarnessConfig } from '@ptah-extension/shared';
import { HarnessBuilderStateService } from '../services/harness-builder-state.service';
import { HarnessConfigPreviewComponent } from './harness-config-preview.component';

describe('HarnessConfigPreviewComponent', () => {
  let fixture: ComponentFixture<HarnessConfigPreviewComponent>;
  const legacyConfig = signal<Partial<HarnessConfig>>({});
  const legacyDocument = signal('');

  beforeEach(async () => {
    legacyConfig.set({});
    legacyDocument.set('');
    await TestBed.configureTestingModule({
      imports: [HarnessConfigPreviewComponent],
      providers: [
        {
          provide: HarnessBuilderStateService,
          useValue: {
            config: legacyConfig,
            generatedDocument: legacyDocument,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HarnessConfigPreviewComponent);
  });

  it('shows guidance when empty and supports the legacy config source', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No configuration yet');
    legacyConfig.set({
      persona: {
        label: 'Engineer',
        description: 'Builds apps',
        goals: ['Ship'],
      },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Engineer');
    expect(fixture.nativeElement.textContent).toContain('Ship');
  });

  it('renders explicit config input, named cards, and a focusable document viewer', () => {
    legacyDocument.set('Old tab document');
    fixture.componentRef.setInput('config', {
      persona: { label: 'Architect', description: '', goals: [] },
      agents: {
        enabledAgents: { claude: { enabled: true } },
        harnessSubagents: [],
      },
      skills: { selectedSkills: ['review'], createdSkills: [] },
      prompt: { systemPrompt: 'Review changes', enhancedSections: {} },
      mcp: {
        servers: [
          { name: 'GitHub', url: 'https://example.com', enabled: true },
        ],
        enabledTools: {},
      },
    } satisfies Partial<HarnessConfig>);
    fixture.componentRef.setInput('document', '# Requirements');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Architect');
    expect(root.textContent).toContain('GitHub');
    expect(root.querySelectorAll('input[type="checkbox"]')).toHaveLength(6);
    expect(
      Array.from(root.querySelectorAll('input[type="checkbox"]')).map((node) =>
        node.getAttribute('aria-label'),
      ),
    ).toEqual([
      'Persona',
      'Agents',
      'Skills',
      'System Prompt',
      'MCP Servers',
      'Generated document',
    ]);
    const viewer = root.querySelector(
      '[role="region"][aria-label="Generated document"]',
    );
    expect(viewer?.getAttribute('tabindex')).toBe('0');
    expect(viewer?.textContent).toBe('# Requirements');
    fixture.componentRef.setInput('document', null);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Old tab document');
  });

  it('copies document content without modifying the preview', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    fixture.componentRef.setInput('document', '# Requirements');
    fixture.detectChanges();
    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((element) => element.textContent?.trim() === 'Copy');
    button?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(writeText).toHaveBeenCalledWith('# Requirements');
    expect(fixture.nativeElement.textContent).toContain('Copied');
  });

  it('exposes restore actions and keeps other states out of the preview', () => {
    const retry = jest.fn();
    fixture.componentInstance.retry.subscribe(retry);
    fixture.componentRef.setInput('status', 'failed');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[role="alert"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain(
      'No configuration yet',
    );
    (fixture.nativeElement as HTMLElement).querySelector('button')?.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

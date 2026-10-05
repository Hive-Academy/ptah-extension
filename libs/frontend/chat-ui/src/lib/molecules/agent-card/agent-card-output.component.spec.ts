import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import { AgentCardOutputComponent } from './agent-card-output.component';

describe('AgentCardOutputComponent', () => {
  let fixture: ComponentFixture<AgentCardOutputComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentCardOutputComponent],
      providers: [provideSurfaceActiveTesting(), provideMarkdown()],
    }).compileComponents();
    fixture = TestBed.createComponent(AgentCardOutputComponent);
    fixture.componentRef.setInput('embedded', true);
    fixture.componentRef.setInput('stderrSegments', []);
  });

  it('renders tool-result markup as literal text', async () => {
    const content = '```html\n<div class="fixed">x</div>\n```';
    fixture.componentRef.setInput('segments', [
      { type: 'tool-result', content },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('pre')?.textContent).toBe(content);
    expect(host.querySelector('div.fixed')).toBeNull();
    expect(host.querySelector('markdown')).toBeNull();
  });

  it('continues rendering model text as markdown', async () => {
    fixture.componentRef.setInput('segments', [
      { type: 'text', content: '**Model prose**' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('strong')?.textContent).toBe('Model prose');
  });

  it('retains nodes across reparsed, trimmed, and growing streamed output', async () => {
    fixture.componentRef.setInput('segments', [
      { type: 'info', content: 'trimmed from the stream' },
      { type: 'info', content: 'retained after trimming' },
      { type: 'info', content: 'identical segment' },
      { type: 'info', content: 'identical segment' },
      { type: 'text', content: 'partial tail' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    const output = fixture.nativeElement.querySelector('.p-2') as HTMLElement;
    const existingNodes = Array.from(output.children);

    expect(() => {
      fixture.componentRef.setInput('segments', [
        { type: 'info', content: 'retained after trimming' },
        { type: 'info', content: 'identical segment' },
        { type: 'info', content: 'identical segment' },
        { type: 'text', content: 'partial tail, now grown' },
      ]);
      fixture.detectChanges();
    }).not.toThrow();
    await fixture.whenStable();

    const rerenderedNodes = output.children;

    expect(rerenderedNodes[0]).toBe(existingNodes[1]);
    expect(rerenderedNodes[1]).toBe(existingNodes[2]);
    expect(rerenderedNodes[2]).toBe(existingNodes[3]);
    expect(rerenderedNodes[3]).toBe(existingNodes[4]);
    expect(rerenderedNodes[3].textContent).toContain('partial tail, now grown');
  });

});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import { AgentCardOutputComponent } from './agent-card-output.component';

describe('AgentCardOutputComponent', () => {
  let fixture: ComponentFixture<AgentCardOutputComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentCardOutputComponent],
      providers: [provideMarkdown()],
    }).compileComponents();
    fixture = TestBed.createComponent(AgentCardOutputComponent);
    fixture.componentRef.setInput('embedded', true);
    fixture.componentRef.setInput('stderrSegments', []);
  });

  it('renders tool-result markup as literal text', async () => {
    const content = '```html\n<div class="fixed">x</div>\n```';
    fixture.componentRef.setInput('segments', [{ type: 'tool-result', content }]);
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
});

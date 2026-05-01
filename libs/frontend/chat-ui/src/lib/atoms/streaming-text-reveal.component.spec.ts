import { TestBed } from '@angular/core/testing';
import { StreamingTextRevealComponent } from './streaming-text-reveal.component';

describe('StreamingTextRevealComponent', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function compile() {
    await TestBed.configureTestingModule({
      imports: [StreamingTextRevealComponent],
    }).compileComponents();
  }

  it('shows full content immediately when not streaming', async () => {
    await compile();
    const fixture = TestBed.createComponent(StreamingTextRevealComponent);
    fixture.componentRef.setInput('content', 'Hello');
    fixture.componentRef.setInput('isStreaming', false);
    fixture.detectChanges();

    expect(fixture.componentInstance.revealedText()).toBe('Hello');
    expect(fixture.componentInstance.showCursor()).toBe(false);
  });

  it('progressively reveals characters when streaming', async () => {
    await compile();
    const fixture = TestBed.createComponent(StreamingTextRevealComponent);
    fixture.componentRef.setInput('content', 'Hi');
    fixture.componentRef.setInput('isStreaming', true);
    fixture.componentRef.setInput('revealSpeed', 10);
    fixture.detectChanges();

    expect(fixture.componentInstance.revealedText()).toBe('');
    jest.advanceTimersByTime(15);
    fixture.detectChanges();
    expect(fixture.componentInstance.revealedText().length).toBeGreaterThan(0);

    // Advance enough to fully reveal
    jest.advanceTimersByTime(100);
    fixture.detectChanges();
    expect(fixture.componentInstance.revealedText()).toBe('Hi');
  });

  it('flushes remaining content when streaming flips off', async () => {
    await compile();
    const fixture = TestBed.createComponent(StreamingTextRevealComponent);
    fixture.componentRef.setInput('content', 'Stream');
    fixture.componentRef.setInput('isStreaming', true);
    fixture.componentRef.setInput('revealSpeed', 100);
    fixture.detectChanges();

    fixture.componentRef.setInput('isStreaming', false);
    fixture.detectChanges();
    expect(fixture.componentInstance.revealedText()).toBe('Stream');
  });

  it('cleans up the reveal interval on destroy', async () => {
    await compile();
    const fixture = TestBed.createComponent(StreamingTextRevealComponent);
    fixture.componentRef.setInput('content', 'abcdef');
    fixture.componentRef.setInput('isStreaming', true);
    fixture.detectChanges();

    expect(() => fixture.destroy()).not.toThrow();
  });
});

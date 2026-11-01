import { TestBed } from '@angular/core/testing';
import type { LiveModelStats } from '@ptah-extension/chat-ui';
import { BuilderSessionSectionComponent } from './builder-session-section.component';

describe('BuilderSessionSectionComponent', () => {
  it('shows the missing context placeholder without a percent sign', () => {
    TestBed.configureTestingModule({
      imports: [BuilderSessionSectionComponent],
    });
    const fixture = TestBed.createComponent(BuilderSessionSectionComponent);
    fixture.componentRef.setInput('initialized', true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Context — · Cost unavailable',
    );
  });

  it('shows the trusted live context percentage in the collapsed summary', () => {
    TestBed.configureTestingModule({
      imports: [BuilderSessionSectionComponent],
    });
    const fixture = TestBed.createComponent(BuilderSessionSectionComponent);
    fixture.componentRef.setInput('initialized', true);
    fixture.componentRef.setInput('liveModelStats', {
      model: 'model-a',
      contextUsed: 130_000,
      contextWindow: 200_000,
      contextPercent: 65,
      contextCapacity: {
        tokens: 200_000,
        source: 'sdk-native',
        providerId: null,
        model: 'model-a',
      },
    } satisfies LiveModelStats);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Context 65%',
    );
  });

  it.each([
    {
      name: 'resume placeholder',
      stats: {
        model: 'model-a',
        contextKnown: false,
        contextUsed: 0,
        contextWindow: 0,
        contextPercent: 0,
      } satisfies LiveModelStats,
    },
    {
      name: 'unknown capacity',
      stats: {
        model: 'model-a',
        contextKnown: true,
        contextUsed: 130_000,
        contextWindow: 0,
        contextPercent: 0,
        contextCapacity: {
          tokens: null,
          source: 'unknown',
          providerId: null,
          model: 'model-a',
        },
      } satisfies LiveModelStats,
    },
    {
      name: 'provider catalog without provider id',
      stats: {
        model: 'model-a',
        contextKnown: true,
        contextUsed: 130_000,
        contextWindow: 0,
        contextPercent: 0,
        contextCapacity: {
          tokens: 200_000,
          source: 'provider-catalog',
          providerId: null,
          model: 'model-a',
        },
      } satisfies LiveModelStats,
    },
  ])('shows the unavailable context cue for $name', ({ stats }) => {
    TestBed.configureTestingModule({
      imports: [BuilderSessionSectionComponent],
    });
    const fixture = TestBed.createComponent(BuilderSessionSectionComponent);
    fixture.componentRef.setInput('initialized', true);
    fixture.componentRef.setInput('liveModelStats', stats);
    fixture.detectChanges();

    const summary = (fixture.nativeElement as HTMLElement).textContent;
    expect(summary).toContain('Context —');
    expect(summary).not.toContain('Context 0%');
  });
});

import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PromptSuggestionsComponent } from '@ptah-extension/chat-ui';
import { VSCodeService } from '@ptah-extension/core';
import { ChatEmptyStateComponent } from './chat-empty-state.component';
import { ProjectSetupCardComponent } from './project-setup-card.component';

@Component({ selector: 'ptah-project-setup-card', template: '<h2>Get ready</h2>', changeDetection: ChangeDetectionStrategy.OnPush })
class SetupStubComponent {}

@Component({ selector: 'ptah-prompt-suggestions', template: '<button (click)="promptSelected.emit(\'Try a prompt\')">Suggestion</button>', changeDetection: ChangeDetectionStrategy.OnPush })
class SuggestionsStubComponent {
  readonly promptSelected = output<string>();
}

describe('ChatEmptyStateComponent', () => {
  const originalMatchMedia = window.matchMedia;
  beforeEach(async () => {
    window.matchMedia = jest.fn(() => ({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    } as MediaQueryList));
    await TestBed.configureTestingModule({
      imports: [ChatEmptyStateComponent],
      providers: [{ provide: VSCodeService, useValue: { getPtahIconUri: () => '/ptah.svg' } }],
    })
      .overrideComponent(ChatEmptyStateComponent, {
        remove: { imports: [ProjectSetupCardComponent, PromptSuggestionsComponent] },
        add: { imports: [SetupStubComponent, SuggestionsStubComponent] },
      })
      .compileComponents();
  });
  afterEach(() => { window.matchMedia = originalMatchMedia; });

  it('keeps the brand, suggestions and footer and gates Get ready by showProjectSetup', () => {
    const fixture = TestBed.createComponent(ChatEmptyStateComponent);
    const prompts: string[] = [];
    fixture.componentInstance.promptSelected.subscribe(value => prompts.push(value));
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    element.style.width = '280px';
    expect(element.querySelector('ptah-aurora-effect')?.getAttribute('aria-hidden')).toBe('true');
    const hero = element.querySelector('ptah-aurora-effect')?.parentElement;
    expect(hero?.classList.contains('overflow-hidden')).toBe(true);
    expect(hero?.classList.contains('isolate')).toBe(true);
    expect(element.querySelector('h1')?.textContent).toContain('Ptah');
    expect(element.textContent).toContain('Ancient Wisdom');
    expect(element.textContent).toContain('Suggestion');
    (element.querySelector('ptah-prompt-suggestions button') as HTMLButtonElement).click();
    expect(prompts).toEqual(['Try a prompt']);
    expect(element.querySelector('ptah-project-setup-card')).toBeNull();
    fixture.componentRef.setInput('showProjectSetup', true);
    fixture.detectChanges();
    expect(element.querySelector('ptah-project-setup-card')?.textContent).toContain('Get ready');
    expect(element.querySelectorAll('ptah-project-setup-card')).toHaveLength(1);
    expect(element.querySelector('ptah-prompt-suggestions')).toBeTruthy();
    expect(element.querySelector('[aria-hidden="true"]')).toBeTruthy();
    fixture.destroy();
  });

  it.each(['anubis', 'anubis-light'])('keeps brand Aurora inside the clipped hero in %s', theme => {
    const fixture = TestBed.createComponent(ChatEmptyStateComponent);
    fixture.componentRef.setInput('showProjectSetup', true);
    fixture.nativeElement.setAttribute('data-theme', theme);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const hero = element.querySelector('ptah-aurora-effect')?.parentElement;
    expect(hero?.classList.contains('overflow-hidden')).toBe(true);
    expect(hero?.contains(element.querySelector('ptah-project-setup-card'))).toBe(false);
    expect(hero?.contains(element.querySelector('ptah-prompt-suggestions'))).toBe(false);
    fixture.destroy();
  });
});

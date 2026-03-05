import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WelcomeComponent } from './welcome.component';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';

describe.skip('WelcomeComponent', () => {
  let component: WelcomeComponent;
  let fixture: ComponentFixture<WelcomeComponent>;
  let mockStateService: Partial<SetupWizardStateService>;

  beforeEach(async () => {
    mockStateService = {
      setCurrentStep: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [WelcomeComponent],
      providers: [
        { provide: SetupWizardStateService, useValue: mockStateService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WelcomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Initial State', () => {
    it('should display welcome heading', () => {
      const heading = fixture.nativeElement.querySelector('h1');
      expect(heading.textContent).toContain(
        "Let's Personalize Your Ptah Experience"
      );
    });

    it('should display estimated time', () => {
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Estimated time: 2-4 minutes');
    });

    it('should display start button', () => {
      const button = fixture.nativeElement.querySelector('button');
      expect(button).toBeTruthy();
      expect(button.textContent).toContain('Start Setup');
    });
  });

  describe('Start Setup', () => {
    it('should transition to scan step when start button clicked', () => {
      const button = fixture.nativeElement.querySelector('button');
      button.click();

      expect(mockStateService.setCurrentStep).toHaveBeenCalledWith('scan');
    });

    it('should transition to scan step via onStartSetup', () => {
      component['onStartSetup']();

      expect(mockStateService.setCurrentStep).toHaveBeenCalledWith('scan');
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading hierarchy', () => {
      const h1 = fixture.nativeElement.querySelector('h1');
      expect(h1).toBeTruthy();
    });

    it('should have accessible button with aria-label', () => {
      const button = fixture.nativeElement.querySelector('button');
      expect(button.getAttribute('aria-label')).toBe('Start wizard setup');
    });

    it('should have accessible button text', () => {
      const button = fixture.nativeElement.querySelector('button');
      expect(button.textContent.trim()).toBeTruthy();
    });
  });
});

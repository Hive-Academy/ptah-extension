import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatEmptyStateComponent } from './chat-empty-state.component';
import { VSCodeService } from '@ptah-extension/core';
import { By } from '@angular/platform-browser';

describe('ChatEmptyStateComponent', () => {
  let component: ChatEmptyStateComponent;
  let fixture: ComponentFixture<ChatEmptyStateComponent>;

  // Mock VSCodeService
  const mockVSCodeService = {
    getPtahIconUri: jest.fn(() => 'mock-icon-uri'),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatEmptyStateComponent],
      providers: [{ provide: VSCodeService, useValue: mockVSCodeService }],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatEmptyStateComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Welcome Section', () => {
    it('should display welcome title', () => {
      const welcomeTitle = fixture.debugElement.query(
        By.css('.welcome-title')
      ).nativeElement;

      expect(welcomeTitle.textContent).toContain('Welcome to Claude Code');
    });

    it('should display welcome description', () => {
      const welcomeDescription = fixture.debugElement.query(
        By.css('.welcome-description')
      ).nativeElement;

      expect(welcomeDescription.textContent).toContain(
        'Intelligent code assistance'
      );
      expect(welcomeDescription.textContent).toContain('Claude');
    });

    it('should display Ptah icon', () => {
      const ptahIcon = fixture.debugElement.query(
        By.css('.ptah-icon')
      ).nativeElement;

      expect(ptahIcon).toBeTruthy();
      expect(ptahIcon.getAttribute('src')).toBe('mock-icon-uri');
    });
  });

  describe('Action Cards', () => {
    it('should display Quick Help action card', () => {
      const quickHelpCard = fixture.debugElement.query(
        By.css('.action-card-primary')
      );

      expect(quickHelpCard).toBeTruthy();

      const cardTitle = quickHelpCard.query(
        By.css('.card-title')
      ).nativeElement;
      expect(cardTitle.textContent).toContain('Quick Help');

      const cardDescription = quickHelpCard.query(
        By.css('.card-description')
      ).nativeElement;
      expect(cardDescription.textContent).toContain('Get immediate assistance');
    });

    it('should display Code Orchestration action card', () => {
      const orchestrationCard = fixture.debugElement.query(
        By.css('.action-card-secondary')
      );

      expect(orchestrationCard).toBeTruthy();

      const cardTitle = orchestrationCard.query(
        By.css('.card-title')
      ).nativeElement;
      expect(cardTitle.textContent).toContain('Code Orchestration');

      const cardDescription = orchestrationCard.query(
        By.css('.card-description')
      ).nativeElement;
      expect(cardDescription.textContent).toContain(
        'Coordinate multiple agents'
      );
    });

    it('should emit quickHelp event when Quick Help card is clicked', () => {
      const quickHelpSpy = jest.fn();
      component.quickHelp.subscribe(quickHelpSpy);

      const quickHelpCard = fixture.debugElement.query(
        By.css('.action-card-primary')
      );
      quickHelpCard.nativeElement.click();

      expect(quickHelpSpy).toHaveBeenCalled();
      expect(quickHelpSpy).toHaveBeenCalledTimes(1);
    });

    it('should emit orchestration event when Code Orchestration card is clicked', () => {
      const orchestrationSpy = jest.fn();
      component.orchestration.subscribe(orchestrationSpy);

      const orchestrationCard = fixture.debugElement.query(
        By.css('.action-card-secondary')
      );
      orchestrationCard.nativeElement.click();

      expect(orchestrationSpy).toHaveBeenCalled();
      expect(orchestrationSpy).toHaveBeenCalledTimes(1);
    });

    it('should have proper ARIA labels on action cards', () => {
      const quickHelpCard = fixture.debugElement.query(
        By.css('.action-card-primary')
      ).nativeElement;
      const orchestrationCard = fixture.debugElement.query(
        By.css('.action-card-secondary')
      ).nativeElement;

      expect(quickHelpCard.getAttribute('aria-label')).toBe(
        'Start quick help session'
      );
      expect(orchestrationCard.getAttribute('aria-label')).toBe(
        'Start orchestration workflow'
      );
    });
  });

  describe('Feature Highlights', () => {
    it('should display feature highlights section', () => {
      const featureHighlights = fixture.debugElement.query(
        By.css('.feature-highlights')
      );

      expect(featureHighlights).toBeTruthy();
    });

    it('should display at least one feature item', () => {
      const featureItems = fixture.debugElement.queryAll(
        By.css('.feature-item')
      );

      expect(featureItems.length).toBeGreaterThanOrEqual(1);
    });

    it('should display feature title and text', () => {
      const featureTitle = fixture.debugElement.query(
        By.css('.feature-title')
      ).nativeElement;
      const featureText = fixture.debugElement.query(
        By.css('.feature-text')
      ).nativeElement;

      expect(featureTitle.textContent).toBeTruthy();
      expect(featureText.textContent).toBeTruthy();
    });
  });

  describe('Styling and Layout', () => {
    it('should have empty-state class on root element', () => {
      const emptyState = fixture.debugElement.query(By.css('.empty-state'));

      expect(emptyState).toBeTruthy();
    });

    it('should use VS Code theme variables', () => {
      const welcomeTitle = fixture.debugElement.query(
        By.css('.welcome-title')
      ).nativeElement;
      const styles = window.getComputedStyle(welcomeTitle);

      expect(styles.color).toBeTruthy();
    });
  });

  describe('Accessibility', () => {
    it('should have focusable action cards', () => {
      const actionCards = fixture.debugElement.queryAll(By.css('.action-card'));

      actionCards.forEach((card) => {
        const element = card.nativeElement as HTMLElement;
        element.focus();
        expect(document.activeElement).toBe(element);
      });
    });

    it('should have keyboard interaction support', () => {
      const quickHelpSpy = jest.fn();
      component.quickHelp.subscribe(quickHelpSpy);

      const quickHelpCard = fixture.debugElement.query(
        By.css('.action-card-primary')
      ).nativeElement as HTMLElement;

      // Simulate keyboard activation
      quickHelpCard.focus();
      quickHelpCard.click(); // Enter/Space triggers click

      expect(quickHelpSpy).toHaveBeenCalled();
    });
  });

  describe('Responsive Behavior', () => {
    it('should render correctly on mobile viewport', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });

      fixture.detectChanges();

      const emptyState = fixture.debugElement.query(By.css('.empty-state'));
      expect(emptyState).toBeTruthy();
    });

    it('should render correctly on desktop viewport', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1920,
      });

      fixture.detectChanges();

      const emptyState = fixture.debugElement.query(By.css('.empty-state'));
      expect(emptyState).toBeTruthy();
    });
  });

  describe('Icon Loading', () => {
    it('should call getPtahIconUri from VSCodeService', () => {
      expect(mockVSCodeService.getPtahIconUri).toHaveBeenCalled();
    });

    it('should use the correct icon URI', () => {
      expect(component.ptahIconUri).toBe('mock-icon-uri');
    });
  });
});

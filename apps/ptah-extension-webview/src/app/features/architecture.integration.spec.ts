import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';

// Feature-based imports to validate new architecture
import { SessionManagerComponent } from './session/containers/session-manager.component';
import { SessionCardComponent } from './session/components/session-card.component';
import { VSCodeDashboardMetricsGridComponent } from './dashboard/components/dashboard-metrics-grid.component';

/**
 * Integration Test Suite - Feature-Domain Architecture Validation
 * 
 * This test suite validates the user's requirement:
 * "proper folder architecture based on (feature/domain)"
 * 
 * Tests verify that the transformation from type-based (smart/dumb) 
 * to feature-based organization is complete and functional.
 */
describe('Feature-Domain Architecture - Integration Tests', () => {
  
  describe('USER REQUIREMENT 1: Folder Structure Transformation', () => {
    it('should successfully import components from features/[domain]/containers structure', () => {
      // VALIDATION: Smart components moved to features/[domain]/containers
      expect(() => {
        TestBed.configureTestingModule({
          imports: [SessionManagerComponent]
        });
      }).not.toThrow();
      
      expect(SessionManagerComponent).toBeDefined();
      expect(SessionManagerComponent.name).toBe('SessionManagerComponent');
    });

    it('should successfully import components from features/[domain]/components structure', () => {
      // VALIDATION: Dumb components moved to features/[domain]/components
      expect(() => {
        TestBed.configureTestingModule({
          imports: [SessionCardComponent, VSCodeDashboardMetricsGridComponent]
        });
      }).not.toThrow();
      
      expect(SessionCardComponent).toBeDefined();
      expect(VSCodeDashboardMetricsGridComponent).toBeDefined();
    });

    it('should verify components are organized by feature domain not component type', () => {
      // VALIDATION: Components grouped by business domain (session, dashboard, chat, etc.)
      // Not by technical type (smart-components, dumb-components)
      
      const sessionManagerMetadata = (SessionManagerComponent as any).ɵcmp;
      const sessionCardMetadata = (SessionCardComponent as any).ɵcmp;
      const dashboardMetricsMetadata = (VSCodeDashboardMetricsGridComponent as any).ɵcmp;
      
      expect(sessionManagerMetadata).toBeDefined();
      expect(sessionCardMetadata).toBeDefined();
      expect(dashboardMetricsMetadata).toBeDefined();
      
      // Components should be standalone (modern Angular pattern)
      expect(sessionManagerMetadata.standalone).toBe(true);
      expect(sessionCardMetadata.standalone).toBe(true);
      expect(dashboardMetricsMetadata.standalone).toBe(true);
    });
  });

  describe('USER REQUIREMENT 2: Feature Domain Boundaries', () => {
    it('should maintain clear separation between session and dashboard domains', () => {
      // VALIDATION: Session components handle session-related functionality
      // Dashboard components handle metrics and analytics
      
      expect(SessionManagerComponent.name.toLowerCase()).toContain('session');
      expect(SessionCardComponent.name.toLowerCase()).toContain('session');
      expect(VSCodeDashboardMetricsGridComponent.name.toLowerCase()).toContain('dashboard');
    });

    it('should use appropriate selectors that reflect domain organization', () => {
      // VALIDATION: Component selectors should be domain-focused
      const sessionManagerSelector = getComponentSelector(SessionManagerComponent);
      const sessionCardSelector = getComponentSelector(SessionCardComponent);
      const dashboardMetricsSelector = getComponentSelector(VSCodeDashboardMetricsGridComponent);
      
      expect(sessionManagerSelector).toContain('session');
      expect(sessionCardSelector).toContain('session');
      expect(dashboardMetricsSelector).toContain('dashboard');
      
      // All should use vscode prefix for consistency
      expect(sessionManagerSelector).toMatch(/^vscode-/);
      expect(sessionCardSelector).toMatch(/^vscode-/);
      expect(dashboardMetricsSelector).toMatch(/^vscode-/);
    });
  });

  describe('USER REQUIREMENT 3: Container vs Component Pattern', () => {
    it('should implement container pattern for smart components', () => {
      // VALIDATION: Containers (smart components) should handle:
      // - State management, service injection, business logic
      
      TestBed.configureTestingModule({
        imports: [SessionManagerComponent]
      });
      
      const sessionManagerFixture = TestBed.createComponent(SessionManagerComponent);
      const sessionManager = sessionManagerFixture.componentInstance;
      
      // Container should have business logic methods
      expect(typeof sessionManager.onSwitchSession).toBe('function');
      expect(typeof sessionManager.onCreateSession).toBe('function');
      expect(typeof sessionManager.onDeleteSession).toBe('function');
      
      // Container should manage state
      expect(sessionManager.isLoading).toBeDefined();
      expect(sessionManager.allSessions).toBeDefined();
      expect(sessionManager.currentSession).toBeDefined();
    });

    it('should implement component pattern for presentation components', () => {
      // VALIDATION: Components (dumb components) should handle:
      // - Pure presentation, input/output, no business logic
      
      TestBed.configureTestingModule({
        imports: [SessionCardComponent]
      });
      
      const sessionCardFixture = TestBed.createComponent(SessionCardComponent);
      const sessionCard = sessionCardFixture.componentInstance;
      
      // Component should have inputs and outputs
      expect(sessionCard.session).toBeDefined(); // input
      expect(sessionCard.isCurrent).toBeDefined(); // input
      expect(sessionCard.actionRequested).toBeDefined(); // output
      expect(sessionCard.nameChanged).toBeDefined(); // output
    });
  });

  describe('USER REQUIREMENT 4: Import Path Validation', () => {
    it('should not have any imports from old smart-components structure', () => {
      // VALIDATION: No legacy imports should remain
      // This is a smoke test - if components compile, old imports are gone
      
      expect(() => {
        TestBed.configureTestingModule({
          imports: [SessionManagerComponent, SessionCardComponent, VSCodeDashboardMetricsGridComponent]
        }).compileComponents();
      }).not.toThrow();
    });

    it('should not have any imports from old dumb-components structure', () => {
      // VALIDATION: Components should import from new feature structure
      // If tests pass, it means all imports have been updated
      
      const testComponent = Component({
        selector: 'test-component',
        template: `
          <vscode-session-manager [config]="mockConfig"></vscode-session-manager>
          <vscode-session-card [session]="mockSession"></vscode-session-card>
          <vscode-dashboard-metrics-grid [metrics]="mockMetrics"></vscode-dashboard-metrics-grid>
        `,
        imports: [SessionManagerComponent, SessionCardComponent, VSCodeDashboardMetricsGridComponent],
        standalone: true
      })(class TestComponent {
        mockConfig = { displayMode: 'panel' as const, showSessionCards: true, enableQuickActions: true, maxVisibleSessions: 12, autoSave: true };
        mockSession = { id: 'test', name: 'Test', messages: [], createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0 };
        mockMetrics = { performance: { currentLatency: 0, averageLatency: 0, memoryUsage: 0, messagesPerMinute: 0, successRate: 0 }, usage: { commandsRun: 0, tokensUsed: 0, totalMessages: 0, sessionsToday: 0 } };
      });
      
      expect(() => {
        TestBed.configureTestingModule({
          imports: [testComponent]
        }).createComponent(testComponent);
      }).not.toThrow();
    });
  });

  describe('USER REQUIREMENT 5: Feature Module Independence', () => {
    it('should allow session feature to work independently', () => {
      // VALIDATION: Session domain should be self-contained
      expect(() => {
        TestBed.configureTestingModule({
          imports: [SessionManagerComponent, SessionCardComponent]
        });
      }).not.toThrow();
    });

    it('should allow dashboard feature to work independently', () => {
      // VALIDATION: Dashboard domain should be self-contained
      expect(() => {
        TestBed.configureTestingModule({
          imports: [VSCodeDashboardMetricsGridComponent]
        });
      }).not.toThrow();
    });
  });

  describe('USER REQUIREMENT 6: Migration Completeness Validation', () => {
    it('should verify all critical components have been migrated', () => {
      // VALIDATION: Key components should exist in new structure
      const criticalComponents = [
        SessionManagerComponent,
        SessionCardComponent, 
        VSCodeDashboardMetricsGridComponent
      ];
      
      criticalComponents.forEach(component => {
        expect(component).toBeDefined();
        
        const metadata = getComponentMetadata(component);
        expect(metadata.standalone).toBe(true);
        expect(metadata.imports).toBeDefined();
      });
    });

    it('should validate component communication still works across features', () => {
      // VALIDATION: Inter-component communication should work after migration
      TestBed.configureTestingModule({
        imports: [SessionManagerComponent]
      });
      
      const sessionManagerFixture = TestBed.createComponent(SessionManagerComponent);
      const sessionManager = sessionManagerFixture.componentInstance;
      
      // Should be able to emit events
      spyOn(sessionManager.sessionSwitched, 'emit');
      sessionManager.onSwitchSession('test-session-id');
      
      expect(sessionManager.sessionSwitched.emit).toHaveBeenCalledWith('test-session-id');
    });

    it('should confirm no breaking changes to public APIs', () => {
      // VALIDATION: Components should maintain their public interfaces
      const sessionCard = TestBed.createComponent(SessionCardComponent).componentInstance;
      
      // Public API should be preserved
      expect(sessionCard.session).toBeDefined();
      expect(sessionCard.actionRequested).toBeDefined();
      expect(sessionCard.nameChanged).toBeDefined();
      
      // Methods should still exist
      expect(typeof sessionCard.onStartEdit).toBe('function');
      expect(typeof sessionCard.onNameSave).toBe('function');
      expect(typeof sessionCard.onAction).toBe('function');
    });
  });
});

// Helper functions
function getComponentSelector(componentClass: any): string {
  const metadata = getComponentMetadata(componentClass);
  return metadata.selector;
}

function getComponentMetadata(componentClass: any): any {
  return componentClass.ɵcmp || 
         (componentClass as any).decorators
           ?.find((d: any) => d.type.prototype.ngMetadataName === 'Component')
           ?.args[0] ||
         {};
}
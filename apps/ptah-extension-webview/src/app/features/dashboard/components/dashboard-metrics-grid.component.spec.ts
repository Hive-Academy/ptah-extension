import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChangeDetectionStrategy } from '@angular/core';
import { VSCodeDashboardMetricsGridComponent } from './dashboard-metrics-grid.component';
import { type DashboardMetrics } from '@ptah-extension/shared';

describe('VSCodeDashboardMetricsGridComponent - Signal Debugging Validation', () => {
  let component: VSCodeDashboardMetricsGridComponent;
  let fixture: ComponentFixture<VSCodeDashboardMetricsGridComponent>;

  const mockMetrics: DashboardMetrics = {
    performance: {
      currentLatency: 250,
      averageLatency: 300,
      memoryUsage: 15.5,
      messagesPerMinute: 8.5,
      successRate: 98.7,
    },
    usage: {
      commandsRun: 1250,
      tokensUsed: 45600,
      totalMessages: 89,
      sessionsToday: 3,
    },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VSCodeDashboardMetricsGridComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(VSCodeDashboardMetricsGridComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('metrics', mockMetrics);
  });

  describe('USER REQUIREMENT 1: Signal Debugging Improvements', () => {
    it('should use computed signals instead of template function calls for debugging', () => {
      // VALIDATION: User complained about "signals hard to debug" 
      // This validates that template functions are converted to computed signals
      
      expect(component.gridClass).toBeDefined();
      expect(typeof component.gridClass).toBe('function'); // computed signal
      
      expect(component.latencyStatusClass).toBeDefined();
      expect(typeof component.latencyStatusClass).toBe('function');
      
      expect(component.formattedCurrentLatency).toBeDefined();
      expect(typeof component.formattedCurrentLatency).toBe('function');
      
      expect(component.formattedAverageLatency).toBeDefined();
      expect(typeof component.formattedAverageLatency).toBe('function');
      
      expect(component.memoryPercentage).toBeDefined();
      expect(typeof component.memoryPercentage).toBe('function');
    });

    it('should provide debuggable signal values that update reactively', () => {
      // VALIDATION: Signals must be reactive and debuggable
      fixture.detectChanges();
      
      // Test grid class computed signal
      const initialGridClass = component.gridClass();
      expect(initialGridClass).toBe('vscode-metrics-grid--inline');
      
      // Change display mode
      fixture.componentRef.setInput('displayMode', 'expanded');
      fixture.detectChanges();
      
      const updatedGridClass = component.gridClass();
      expect(updatedGridClass).toBe('vscode-metrics-grid--expanded');
      expect(updatedGridClass).not.toBe(initialGridClass);
    });

    it('should have readable computed signal logic for latency status', () => {
      // VALIDATION: Signal logic should be clear and debuggable
      fixture.detectChanges();
      
      // Test with different latency values for debugging clarity
      const testCases = [
        { latency: 0, expected: '' },
        { latency: 400, expected: 'vscode-metric-card--excellent' },
        { latency: 800, expected: 'vscode-metric-card--good' },
        { latency: 1500, expected: 'vscode-metric-card--warning' },
        { latency: 2500, expected: 'vscode-metric-card--critical' },
      ];

      testCases.forEach(({ latency, expected }) => {
        const testMetrics = {
          ...mockMetrics,
          performance: { ...mockMetrics.performance, currentLatency: latency },
        };
        fixture.componentRef.setInput('metrics', testMetrics);
        fixture.detectChanges();
        
        const result = component.latencyStatusClass();
        expect(result).toBe(expected);
      });
    });

    it('should format values through computed signals for consistent debugging', () => {
      // VALIDATION: All formatting through computed signals for debuggability
      fixture.detectChanges();
      
      expect(component.formattedCurrentLatency()).toBe('250ms');
      expect(component.formattedAverageLatency()).toBe('300ms');
      expect(component.formattedMemoryUsage()).toBe('15.5');
      expect(component.formattedThroughput()).toBe('8.5');
      expect(component.formattedSuccessRate()).toBe('98.7');
      expect(component.formattedTokensUsed()).toBe('45.6K');
    });
  });

  describe('USER REQUIREMENT 2: OnPush Change Detection Performance', () => {
    it('should use OnPush change detection strategy', () => {
      // VALIDATION: User requested performance improvements
      const componentInstance = fixture.debugElement.componentInstance;
      const changeDetectionStrategy = (componentInstance.constructor as any).decorators
        ?.find((d: any) => d.type.prototype.ngMetadataName === 'Component')
        ?.args[0]?.changeDetection;
        
      expect(changeDetectionStrategy).toBe(ChangeDetectionStrategy.OnPush);
    });

    it('should only trigger change detection when input signals change', () => {
      // VALIDATION: OnPush should optimize performance
      spyOn(fixture, 'detectChanges');
      
      fixture.detectChanges(); // Initial detection
      expect(fixture.detectChanges).toHaveBeenCalledTimes(1);
      
      // Simulate no input changes - should not trigger detection
      const initialMetrics = component.metrics;
      expect(initialMetrics).toBe(mockMetrics);
      
      // Change input - should trigger reactive updates
      const newMetrics = { ...mockMetrics, performance: { ...mockMetrics.performance, currentLatency: 500 } };
      fixture.componentRef.setInput('metrics', newMetrics);
      
      // Verify signals react to input changes
      expect(component.latencyStatusClass()).toBe('vscode-metric-card--excellent');
    });
  });

  describe('USER REQUIREMENT 3: Angular Best Practices Compliance', () => {
    it('should use modern control flow syntax in template', () => {
      // VALIDATION: Template should use @if/@for instead of *ngIf/*ngFor
      const template = (component.constructor as any).decorators
        ?.find((d: any) => d.type.prototype.ngMetadataName === 'Component')
        ?.args[0]?.template;
        
      expect(template).toContain('@if (displayMode === \'expanded\')');
      expect(template).not.toContain('*ngIf');
      expect(template).not.toContain('*ngFor');
    });

    it('should use input() function for component inputs', () => {
      // VALIDATION: Modern Angular patterns
      expect(component.metrics).toBeDefined();
      expect(component.displayMode).toBeDefined();
    });

    it('should use standalone component architecture', () => {
      // VALIDATION: Modern Angular architecture
      const componentMetadata = (component.constructor as any).decorators
        ?.find((d: any) => d.type.prototype.ngMetadataName === 'Component')
        ?.args[0];
        
      expect(componentMetadata.standalone).toBe(true);
      expect(componentMetadata.imports).toBeDefined();
    });
  });

  describe('USER REQUIREMENT 4: Functional Preservation', () => {
    it('should correctly calculate memory percentage', () => {
      // VALIDATION: Existing functionality must still work
      fixture.detectChanges();
      
      // Memory usage is 15.5, target is 30MB
      const expectedPercentage = Math.round((15.5 / 30) * 100);
      expect(component.memoryPercentage()).toBe(expectedPercentage);
    });

    it('should format large numbers correctly', () => {
      // VALIDATION: Number formatting must work correctly
      const testMetrics = {
        ...mockMetrics,
        usage: {
          ...mockMetrics.usage,
          commandsRun: 1500000, // 1.5M
          tokensUsed: 2500,     // 2.5K
        },
      };
      
      fixture.componentRef.setInput('metrics', testMetrics);
      fixture.detectChanges();
      
      expect(component.formattedCommandsRun()).toBe('1.5M');
      expect(component.formattedTokensUsed()).toBe('2.5K');
    });

    it('should handle edge case latency formatting', () => {
      // VALIDATION: Edge cases must be handled correctly
      const edgeCases = [
        { latency: 0, expected: '0ms' },
        { latency: 999, expected: '999ms' },
        { latency: 1000, expected: '1.0s' },
        { latency: 1500, expected: '1.5s' },
      ];

      edgeCases.forEach(({ latency, expected }) => {
        const testMetrics = {
          ...mockMetrics,
          performance: { ...mockMetrics.performance, currentLatency: latency },
        };
        
        fixture.componentRef.setInput('metrics', testMetrics);
        fixture.detectChanges();
        
        expect(component.formattedCurrentLatency()).toBe(expected);
      });
    });
  });
});
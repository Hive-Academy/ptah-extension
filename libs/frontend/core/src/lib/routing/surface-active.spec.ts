import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NgComponentOutlet } from '@angular/common';
import { provideSurfaceRouterTesting } from '../../testing/surface-router-testing';
import { SurfaceRouterService } from './surface-router.service';
import { SURFACE_ACTIVE, surfaceActiveFor } from './surface-active';
import { SurfaceActiveDirective } from './surface-active.directive';

@Component({
  selector: 'ptah-activity-probe',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '{{ active() }}',
})
class ActivityProbe {
  readonly active = inject(SURFACE_ACTIVE);
}

@Component({
  imports: [SurfaceActiveDirective, ActivityProbe, NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div ptahSurfaceActive>
      <ng-container *ngComponentOutlet="canvas" />
    </div>
  `,
})
class PersistentSurface {
  readonly canvas = ActivityProbe;
}

describe('surface activity injector boundaries', () => {
  it('tracks the settled chat route without recreating the persistent child', async () => {
    TestBed.configureTestingModule({
      imports: [PersistentSurface],
      providers: [
        ...provideSurfaceRouterTesting(),
        { provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('settings') },
      ],
    });
    const routeActivity = TestBed.inject(SURFACE_ACTIVE);
    const router = TestBed.inject(SurfaceRouterService);
    const fixture = TestBed.createComponent(PersistentSurface);
    fixture.detectChanges();
    const probe = fixture.nativeElement.querySelector('ptah-activity-probe');
    const value = () => probe.textContent?.trim();
    expect(value()).toBe('true');
    await router.navigateToSurface('settings');
    fixture.detectChanges();
    expect(routeActivity()).toBe(true);
    expect(value()).toBe('false');
    await router.navigateToSurface('chat');
    fixture.detectChanges();
    expect(routeActivity()).toBe(false);
    expect(value()).toBe('true');
    expect(fixture.nativeElement.querySelector('ptah-activity-probe')).toBe(
      probe,
    );
  });
});

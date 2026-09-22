import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NgComponentOutlet } from '@angular/common';
import {
  AppStateManager,
  type LayoutMode,
} from '../services/app-state.service';
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
    <div ptahSurfaceActive="chat"><ptah-activity-probe /></div>
    <div ptahSurfaceActive="canvas">
      <ng-container *ngComponentOutlet="canvas" />
    </div>
  `,
})
class PersistentSurfaces {
  readonly canvas = ActivityProbe;
}

describe('surface activity injector boundaries', () => {
  it('tracks settled routes and both persistent layouts without recreating children', async () => {
    const layoutMode = signal<LayoutMode>('single');
    TestBed.configureTestingModule({
      imports: [PersistentSurfaces],
      providers: [
        ...provideSurfaceRouterTesting(),
        { provide: AppStateManager, useValue: { layoutMode } },
        { provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('settings') },
      ],
    });
    const routeActivity = TestBed.inject(SURFACE_ACTIVE);
    const router = TestBed.inject(SurfaceRouterService);
    const fixture = TestBed.createComponent(PersistentSurfaces);
    fixture.detectChanges();
    const nodes = fixture.nativeElement.querySelectorAll('ptah-activity-probe');
    const values = () =>
      Array.from(nodes, (node: Element) => node.textContent?.trim());
    expect(values()).toEqual(['true', 'false']);
    layoutMode.set('grid');
    fixture.detectChanges();
    expect(values()).toEqual(['false', 'true']);
    await router.navigateToSurface('settings');
    fixture.detectChanges();
    expect(routeActivity()).toBe(true);
    expect(values()).toEqual(['false', 'false']);
    await router.navigateToSurface('chat');
    fixture.detectChanges();
    expect(routeActivity()).toBe(false);
    expect(values()).toEqual(['false', 'true']);
    expect(fixture.nativeElement.querySelector('ptah-activity-probe')).toBe(
      nodes[0],
    );
  });
});

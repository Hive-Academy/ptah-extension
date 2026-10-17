import { TestBed } from '@angular/core/testing';
import { CommandConnectorsComponent } from './command-connectors.component';
import type { SceneGeometry } from './connector-geometry';

const geometry: SceneGeometry = {
  stage: { x: 0, y: 0, width: 1100, height: 600 },
  streamViewport: { x: 16, y: 40, width: 250, height: 100 },
  streamContent: { x: 16, y: 40, width: 250, height: 100 },
  rows: { one: { x: 16, y: 50, width: 250, height: 44 } },
  dial: { x: 420, y: 130, width: 292, height: 292 },
  rootButton: { x: 467, y: 177, width: 198, height: 198 },
  cards: {
    inProgress: { x: 850, y: 35, width: 200, height: 70 },
    waiting: { x: 850, y: 145, width: 200, height: 70 },
    finished: { x: 850, y: 255, width: 200, height: 70 },
    other: { x: 850, y: 365, width: 200, height: 70 },
  },
};

describe('CommandConnectorsComponent', () => {
  it('renders only decorative, pointer-inert SVG paths from the supplied snapshot', () => {
    TestBed.configureTestingModule({ imports: [CommandConnectorsComponent] });
    const fixture = TestBed.createComponent(CommandConnectorsComponent);
    fixture.componentRef.setInput('geometry', geometry);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const svg = host.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.getAttribute('viewBox')).toBe('0 0 1100 600');
    expect(svg.querySelectorAll('path')).toHaveLength(5);
    expect(svg.querySelectorAll('circle')).toHaveLength(1);
    expect(host.querySelector('a, button, input, [tabindex]')).toBeNull();
    expect(getComputedStyle(host).pointerEvents).toBe('none');
    expect(getComputedStyle(host).zIndex).toBe('0');
  });
});

/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LightfallComponent } from './lightfall.component';
import { LightfallRenderer } from './lightfall-renderer';

interface StubRenderer {
  readonly setOptions: jest.Mock;
  readonly resize: jest.Mock;
  readonly draw: jest.Mock;
  readonly dispose: jest.Mock;
}

function stubRenderer(): StubRenderer {
  return { setOptions: jest.fn(), resize: jest.fn(), draw: jest.fn(), dispose: jest.fn() };
}

function setReducedMotion(reduced: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn((query: string) => ({ matches: reduced && query.includes('reduce'), media: query })),
  });
}

async function render(platform: 'browser' | 'server'): Promise<ComponentFixture<LightfallComponent>> {
  TestBed.configureTestingModule({
    imports: [LightfallComponent],
    providers: [{ provide: PLATFORM_ID, useValue: platform }],
  });
  const fixture = TestBed.createComponent(LightfallComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

function state(fixture: ComponentFixture<LightfallComponent>): string | null {
  return (fixture.nativeElement as HTMLElement).getAttribute('data-state');
}

describe('LightfallComponent', () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    setReducedMotion(false);
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it('renders only the static beam on the server', async () => {
    const create = jest.spyOn(LightfallRenderer, 'create');
    const fixture = await render('server');

    expect(state(fixture)).toBe('static');
    expect(create).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).querySelector('.lf-fallback')).not.toBeNull();
  });

  it('keeps the static beam for reduced motion', async () => {
    setReducedMotion(true);
    const create = jest.spyOn(LightfallRenderer, 'create');
    const fixture = await render('browser');

    expect(create).not.toHaveBeenCalled();
    expect(state(fixture)).toBe('static');
  });

  it('keeps the static beam without WebGL', async () => {
    jest.spyOn(LightfallRenderer, 'create').mockReturnValue(undefined);
    const fixture = await render('browser');

    expect(state(fixture)).toBe('static');
    expect(frames).toHaveLength(0);
  });

  it('goes live after the first frame and releases everything on destroy', async () => {
    const renderer = stubRenderer();
    jest.spyOn(LightfallRenderer, 'create').mockReturnValue(renderer as unknown as LightfallRenderer);
    const removeListener = jest.spyOn(window, 'removeEventListener');
    const fixture = await render('browser');

    expect(renderer.setOptions).toHaveBeenCalledWith(expect.objectContaining({ color: '#ffb340' }));
    expect(frames).toHaveLength(1);
    frames[0](16);
    fixture.detectChanges();
    expect(renderer.draw).toHaveBeenCalledWith(expect.objectContaining({ fade: expect.any(Number) }));
    expect(state(fixture)).toBe('live');
    frames[1](32);
    // One reused frame object: the loop allocates nothing per frame.
    expect(renderer.draw.mock.calls[1][0]).toBe(renderer.draw.mock.calls[0][0]);

    fixture.destroy();
    expect(renderer.dispose).toHaveBeenCalled();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
  });

  it('pauses while the tab is hidden', async () => {
    jest.spyOn(LightfallRenderer, 'create').mockReturnValue(stubRenderer() as unknown as LightfallRenderer);
    await render('browser');
    const hidden = jest.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    hidden.mockRestore();
  });

  it('passes new options to the running light', async () => {
    const renderer = stubRenderer();
    jest.spyOn(LightfallRenderer, 'create').mockReturnValue(renderer as unknown as LightfallRenderer);
    const fixture = await render('browser');
    fixture.componentRef.setInput('options', { flowSpeed: 0.9 });
    fixture.detectChanges();

    expect(renderer.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ flowSpeed: 0.9 }));
  });
});

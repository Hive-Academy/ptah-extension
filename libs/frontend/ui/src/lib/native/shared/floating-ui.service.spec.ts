import { Component, inject } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import * as FloatingDom from '@floating-ui/dom';
import { FloatingUIService } from './floating-ui.service';

jest.mock('@floating-ui/dom', () => {
  const actual = jest.requireActual('@floating-ui/dom');
  return {
    ...actual,
    computePosition: jest.fn(),
    autoUpdate: jest.fn(),
  };
});

@Component({
  standalone: true,
  template: '<div></div>',
  providers: [FloatingUIService],
})
class HostComponent {
  readonly service = inject(FloatingUIService);
}

describe('FloatingUIService', () => {
  let fixture: ComponentFixture<HostComponent>;
  let service: FloatingUIService;
  let reference: HTMLElement;
  let floating: HTMLElement;
  let autoUpdateCleanup: jest.Mock;

  const mockedCompute = FloatingDom.computePosition as unknown as jest.Mock;
  const mockedAutoUpdate = FloatingDom.autoUpdate as unknown as jest.Mock;

  beforeEach(async () => {
    mockedCompute.mockReset();
    mockedAutoUpdate.mockReset();
    autoUpdateCleanup = jest.fn();
    mockedAutoUpdate.mockReturnValue(autoUpdateCleanup);

    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    service = fixture.componentInstance.service;

    reference = document.createElement('div');
    floating = document.createElement('div');
    document.body.appendChild(reference);
    document.body.appendChild(floating);
  });

  afterEach(() => {
    reference.remove();
    floating.remove();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('position()', () => {
    it('should compute position with default options', async () => {
      mockedCompute.mockResolvedValueOnce({ x: 10, y: 20 });

      await service.position(reference, floating);

      expect(mockedCompute).toHaveBeenCalledTimes(1);
      const [refArg, floatArg, opts] = mockedCompute.mock.calls[0] as [
        HTMLElement,
        HTMLElement,
        { placement: string; middleware: unknown[] },
      ];
      expect(refArg).toBe(reference);
      expect(floatArg).toBe(floating);
      expect(opts.placement).toBe('bottom-start');
      // offset + flip + shift = 3 middleware by default
      expect(opts.middleware.length).toBe(3);
    });

    it('should apply computed position styles to the floating element', async () => {
      mockedCompute.mockResolvedValueOnce({ x: 42, y: 84 });

      await service.position(reference, floating);

      expect(floating.style.position).toBe('fixed');
      expect(floating.style.left).toBe('42px');
      expect(floating.style.top).toBe('84px');
      expect(floating.style.visibility).toBe('visible');
    });

    it('should honor custom placement and offset options', async () => {
      mockedCompute.mockResolvedValueOnce({ x: 0, y: 0 });

      await service.position(reference, floating, {
        placement: 'top-end',
        offset: 16,
        flip: false,
        shift: false,
      });

      const [, , opts] = mockedCompute.mock.calls[0] as [
        HTMLElement,
        HTMLElement,
        { placement: string; middleware: unknown[] },
      ];
      expect(opts.placement).toBe('top-end');
      // Only offset middleware
      expect(opts.middleware.length).toBe(1);
    });

    it('should register an auto-update listener', async () => {
      mockedCompute.mockResolvedValueOnce({ x: 0, y: 0 });

      await service.position(reference, floating);

      expect(mockedAutoUpdate).toHaveBeenCalledTimes(1);
      expect(mockedAutoUpdate.mock.calls[0][0]).toBe(reference);
      expect(mockedAutoUpdate.mock.calls[0][1]).toBe(floating);
    });

    it('should re-apply position when auto-update callback fires', async () => {
      mockedCompute
        .mockResolvedValueOnce({ x: 10, y: 20 })
        .mockResolvedValueOnce({ x: 50, y: 60 });

      await service.position(reference, floating);

      // Trigger the auto-update callback
      const updateCallback = mockedAutoUpdate.mock
        .calls[0][2] as () => Promise<void>;
      await updateCallback();

      expect(mockedCompute).toHaveBeenCalledTimes(2);
      expect(floating.style.left).toBe('50px');
      expect(floating.style.top).toBe('60px');
    });

    it('should cleanup previous auto-update when position() is called again', async () => {
      mockedCompute.mockResolvedValue({ x: 0, y: 0 });
      const secondCleanup = jest.fn();
      mockedAutoUpdate
        .mockReturnValueOnce(autoUpdateCleanup)
        .mockReturnValueOnce(secondCleanup);

      await service.position(reference, floating);
      await service.position(reference, floating);

      expect(autoUpdateCleanup).toHaveBeenCalledTimes(1);
      expect(secondCleanup).not.toHaveBeenCalled();
    });
  });

  describe('cleanup()', () => {
    it('should call the auto-update cleanup function', async () => {
      mockedCompute.mockResolvedValueOnce({ x: 0, y: 0 });
      await service.position(reference, floating);

      service.cleanup();

      expect(autoUpdateCleanup).toHaveBeenCalledTimes(1);
    });

    it('should be safe to call when nothing is registered', () => {
      expect(() => service.cleanup()).not.toThrow();
      expect(autoUpdateCleanup).not.toHaveBeenCalled();
    });

    it('should not call cleanup twice for the same listener', async () => {
      mockedCompute.mockResolvedValueOnce({ x: 0, y: 0 });
      await service.position(reference, floating);

      service.cleanup();
      service.cleanup();

      expect(autoUpdateCleanup).toHaveBeenCalledTimes(1);
    });
  });

  describe('DestroyRef integration', () => {
    it('should cleanup auto-update when host component is destroyed', async () => {
      mockedCompute.mockResolvedValueOnce({ x: 0, y: 0 });
      await service.position(reference, floating);

      fixture.destroy();

      expect(autoUpdateCleanup).toHaveBeenCalledTimes(1);
    });
  });
});

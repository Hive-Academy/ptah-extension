import { PanelResizeService } from './panel-resize.service';

describe('PanelResizeService', () => {
  it('allows 75% of the owning container and retains the 300px minimum', () => {
    const service = new PanelResizeService();
    service.setCustomWidth(1000, 1000);
    expect(service.customWidth()).toBe(750);
    service.setCustomWidth(100, 1000);
    expect(service.customWidth()).toBe(300);
    service.setCustomWidth(600, 800);
    expect(service.customWidth()).toBe(600);
  });

  it('fits a container smaller than the normal minimum and resets custom width', () => {
    const service = new PanelResizeService();
    service.setCustomWidth(300, 200);
    expect(service.customWidth()).toBe(150);
    service.resetWidth();
    expect(service.customWidth()).toBeNull();
  });
});

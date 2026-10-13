import type { CanvasDetailService } from './canvas-detail.service';
import { handleCanvasDetailKeydown } from './canvas-detail-keyboard';

describe('handleCanvasDetailKeydown', () => {
  const detail = {
    close: jest.fn(),
    next: jest.fn(),
    prev: jest.fn(),
  } as unknown as CanvasDetailService;

  beforeEach(() => jest.clearAllMocks());

  it('closes detail with Escape from a lane tab while leaving arrows to the tablist', () => {
    const tablist = document.createElement('div');
    tablist.setAttribute('role', 'tablist');
    const tab = document.createElement('button');
    tab.setAttribute('role', 'tab');
    tablist.append(tab);
    tab.addEventListener('keydown', (event) =>
      handleCanvasDetailKeydown(event, true, 'tile-1', detail),
    );

    const arrow = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    tab.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(false);
    expect(detail.next).not.toHaveBeenCalled();

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    tab.dispatchEvent(escape);
    expect(detail.close).toHaveBeenCalledTimes(1);
    expect(escape.defaultPrevented).toBe(true);
  });
});

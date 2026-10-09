import { ScrollDirtyService } from './scroll-dirty.service';

describe('ScrollDirtyService', () => {
  it('runs scroll-dirty work at most once per frame', () => {
    const frames: FrameRequestCallback[] = [];
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const service = new ScrollDirtyService();
    const work = jest.fn();

    service.markDirty(work);
    service.markDirty(work);
    service.markDirty(work);

    expect(frames).toHaveLength(1);
    frames[0](0);
    expect(work).toHaveBeenCalledTimes(1);
  });
});

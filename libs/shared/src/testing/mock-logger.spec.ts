import { createMockLogger } from './mock-logger';

describe('createMockLogger', () => {
  it('produces a jest-mocked logger with all four levels', () => {
    const logger = createMockLogger();
    logger.debug('d', { k: 1 });
    logger.info('i');
    logger.warn('w');
    logger.error('e', { err: 'boom' });

    expect(logger.debug).toHaveBeenCalledWith('d', { k: 1 });
    expect(logger.info).toHaveBeenCalledWith('i');
    expect(logger.warn).toHaveBeenCalledWith('w');
    expect(logger.error).toHaveBeenCalledWith('e', { err: 'boom' });
  });

  it('returns independent mock instances across calls', () => {
    const a = createMockLogger();
    const b = createMockLogger();
    a.info('only-a');
    expect(a.info).toHaveBeenCalledTimes(1);
    expect(b.info).toHaveBeenCalledTimes(0);
  });
});

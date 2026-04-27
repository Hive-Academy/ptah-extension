import 'reflect-metadata';
import { createMockSentryService } from './sentry-service.mock';

describe('createMockSentryService', () => {
  it('exposes every SentryService method as a jest.fn no-op', async () => {
    const mock = createMockSentryService({ initialized: true });

    expect(mock.isInitialized()).toBe(true);

    mock.initialize({
      dsn: 'dsn',
      environment: 'test',
      release: '0.0.0',
      platform: 'node',
      extensionVersion: '0.0.0',
    });
    mock.captureException(new Error('boom'), { errorSource: 'spec' });
    mock.captureMessage('hello', 'info');
    mock.addBreadcrumb('cat', 'msg', { foo: 1 });
    await mock.flush(100);
    await mock.shutdown(100);

    expect(mock.initialize).toHaveBeenCalledTimes(1);
    expect(mock.captureException).toHaveBeenCalledTimes(1);
    expect(mock.captureMessage).toHaveBeenCalledWith('hello', 'info');
    expect(mock.addBreadcrumb).toHaveBeenCalledWith('cat', 'msg', { foo: 1 });
    expect(mock.flush).toHaveBeenCalledWith(100);
    expect(mock.shutdown).toHaveBeenCalledWith(100);
  });
});

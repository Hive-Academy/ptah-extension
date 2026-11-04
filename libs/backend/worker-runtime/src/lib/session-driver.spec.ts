import { InProcessRpc } from './in-process-rpc';
import { SessionDriver, SessionDriverError } from './session-driver';
import { SessionLogWriter } from './session-log-writer';
import { SessionEventLog } from './session-event-log';
import { SessionFanOut } from './fan-out';
import { Transcript } from './transcript';

function setup(runtime?: string) {
  const handleMessage = jest
    .fn()
    .mockResolvedValue({ success: true, data: { success: true } });
  const rpc = new InProcessRpc({ handleMessage }, jest.fn());
  const baseline = jest.fn().mockResolvedValue(undefined);
  const mark = jest.fn().mockResolvedValue(undefined);
  const transcript = { baseline, mark } as unknown as Transcript;
  const metadata = {
    get: jest
      .fn()
      .mockResolvedValue(runtime ? { codexExecution: { runtime } } : null),
  };
  const enqueue = jest.fn().mockResolvedValue({ seq: 1 });
  const writer = { enqueue } as unknown as SessionLogWriter;
  const driver = new SessionDriver(
    rpc,
    transcript,
    metadata,
    () => writer,
    () => true,
    1,
  );
  return { driver, handleMessage, metadata, enqueue, baseline, mark };
}

it('refuses native Codex before chat:continue and before any lock path; metadata failure also refuses', async () => {
  const native = setup('codex-app-server');
  const attach = jest
    .fn()
    .mockResolvedValue({ mode: 'snapshot', events: [], live: false });
  const nativeTranscript = { attach } as unknown as Transcript;
  const nativeDriver = new SessionDriver(
    new InProcessRpc({ handleMessage: native.handleMessage }, jest.fn()),
    nativeTranscript,
    native.metadata,
    () => ({ enqueue: jest.fn() }) as unknown as SessionLogWriter,
    () => true,
    1,
  );
  await expect(nativeDriver.attach('s1', null, null)).resolves.toMatchObject({
    mode: 'snapshot',
  });
  expect(attach).toHaveBeenCalledWith('s1', null, null, undefined, false, true);
  await expect(
    native.driver.continue('s1', 'tab', 'hello'),
  ).rejects.toMatchObject({ code: 'CODEX_UNAVAILABLE' });
  expect(native.handleMessage).not.toHaveBeenCalled();
  const failed = setup();
  failed.metadata.get.mockRejectedValue(new Error('storage failed'));
  await expect(
    failed.driver.continue('s1', 'tab', 'hello'),
  ).rejects.toBeInstanceOf(SessionDriverError);
  expect(failed.handleMessage).not.toHaveBeenCalled();
});

it('claude-sdk and metadata-less sessions take chat:continue; tracks in-flight and busy turns', async () => {
  const normal = setup('claude-sdk');
  await normal.driver.continue('s1', 'tab1', 'hello');
  expect(normal.handleMessage).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'chat:continue' }),
  );
  expect(normal.baseline).toHaveBeenCalledTimes(1);
  await expect(
    normal.driver.continue('s1', 'tab1', 'again'),
  ).rejects.toMatchObject({ code: 'TURN_IN_FLIGHT' });
  await expect(
    normal.driver.continue('s2', 'tab2', 'again'),
  ).rejects.toMatchObject({ code: 'WORKER_BUSY' });
  await normal.driver.end('s1');
  expect(normal.mark).toHaveBeenCalledTimes(1);
  const missing = setup();
  await missing.driver.continue('s2', 'tab2', 'hello');
  expect(missing.handleMessage).toHaveBeenCalledTimes(1);
});

it('refuses without a ready provider before calling chat:continue', async () => {
  const { handleMessage, metadata } = setup();
  const driver = new SessionDriver(
    new InProcessRpc({ handleMessage }, jest.fn()),
    { baseline: jest.fn() } as unknown as Transcript,
    metadata,
    () => ({ enqueue: jest.fn() }) as unknown as SessionLogWriter,
    () => false,
    1,
  );
  await expect(driver.continue('s1', 'tab', 'hello')).rejects.toMatchObject({
    code: 'NO_PROVIDER_READY',
  });
  expect(handleMessage).not.toHaveBeenCalled();
});

it('routes pre-resolution events and aborts through chat:abort when a log append fails', async () => {
  const { driver, handleMessage } = setup();
  const deliver = jest.fn();
  driver.route('tab', { type: 'early' }, deliver);
  driver.resolveTab('tab', 's1', deliver);
  expect(deliver).toHaveBeenCalledWith('s1', { type: 'early' });
  await driver.continue('s1', 'tab', 'hello');
  const failingWriter = new SessionLogWriter(
    { sessionId: 's1' } as unknown as SessionEventLog,
    new SessionFanOut(),
    {
      onAppendFailed: driver.onAppendFailed,
      append: async () => {
        throw new Error('disk failed');
      },
    },
  );
  await expect(
    failingWriter.enqueue('worker:turn.begin', { turnId: 't1' }),
  ).rejects.toMatchObject({ code: 'SESSION_LOG_FAILED' });
  await new Promise((resolve) => setImmediate(resolve));
  expect(handleMessage).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'chat:abort' }),
  );
});

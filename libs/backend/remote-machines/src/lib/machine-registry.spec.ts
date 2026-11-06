import { MachineRegistry } from './machine-registry';

it('rejects corrupt registry before writing', async () => {
  const io = {
    stat: jest.fn(async () => ({ size: 0 })),
    readFile: jest.fn(async () => '{bad json'),
    mkdir: jest.fn(),
    open: jest.fn(),
    rename: jest.fn(),
    unlink: jest.fn(),
  };
  const registry = new MachineRegistry(
    '/tmp/remote-machines.json',
    io as never,
  );
  await expect(registry.write({ machines: [] })).rejects.toThrow(/corrupt/);
  expect(io.rename).not.toHaveBeenCalled();
});

it('writes a mode 0600 temp file, syncs and renames', async () => {
  const handle = {
    writeFile: jest.fn(async () => undefined),
    sync: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  const io = {
    stat: jest.fn(async () => ({ size: 0 })),
    readFile: jest.fn(async () => '{"machines":[]}'),
    mkdir: jest.fn(async () => undefined),
    open: jest.fn(async () => handle),
    rename: jest.fn(async () => undefined),
    unlink: jest.fn(async () => undefined),
  };
  await new MachineRegistry('/tmp/remote-machines.json', io as never).write({
    machines: [{ machineId: 'm', alias: 'host' }],
  });
  expect(io.open).toHaveBeenCalledWith(
    expect.stringMatching(/\.tmp$/),
    'wx',
    0o600,
  );
  expect(handle.sync).toHaveBeenCalled();
  expect(io.rename).toHaveBeenCalled();
});

it('returns an empty registry when the file does not exist', async () => {
  const io = {
    stat: jest.fn(async () => ({ size: 0 })),
    readFile: jest.fn(async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    }),
  };
  await expect(
    new MachineRegistry('/tmp/remote-machines.json', io as never).read(),
  ).resolves.toEqual({ machines: [] });
});

it('reports a schema-invalid registry as corrupt', async () => {
  const io = {
    stat: jest.fn(async () => ({ size: 0 })),
    readFile: jest.fn(
      async () => '{"machines":[{"machineId":"m","alias":"-bad"}]}',
    ),
  };
  await expect(
    new MachineRegistry('/tmp/remote-machines.json', io as never).read(),
  ).rejects.toThrow(/corrupt/);
});

it('removes the temp file when rename fails', async () => {
  const handle = {
    writeFile: jest.fn(async () => undefined),
    sync: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  const io = {
    stat: jest.fn(async () => ({ size: 0 })),
    readFile: jest.fn(async () => '{"machines":[]}'),
    mkdir: jest.fn(async () => undefined),
    open: jest.fn(async () => handle),
    rename: jest.fn(async () => {
      throw new Error('rename failed');
    }),
    unlink: jest.fn(async () => undefined),
  };
  await expect(
    new MachineRegistry('/tmp/remote-machines.json', io as never).write({
      machines: [],
    }),
  ).rejects.toThrow('rename failed');
  expect(io.unlink).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/));
});

it('caps registry input and machine count', async () => {
  const io = {
    stat: jest.fn(async () => ({ size: 256 * 1024 + 1 })),
    readFile: jest.fn(async () => Buffer.alloc(256 * 1024 + 1)),
  };
  await expect(
    new MachineRegistry('/tmp/remote-machines.json', io as never).read(),
  ).rejects.toThrow('256 KiB');
  expect(io.readFile).not.toHaveBeenCalled();
  const many = {
    machines: Array.from({ length: 257 }, (_, n) => ({
      machineId: String(n),
      alias: 'host',
    })),
  };
  const io2 = {
    stat: async () => ({ size: 0 }),
    readFile: async () => JSON.stringify(many),
  };
  await expect(
    new MachineRegistry('/tmp/remote-machines.json', io2 as never).read(),
  ).rejects.toThrow('corrupt');
});

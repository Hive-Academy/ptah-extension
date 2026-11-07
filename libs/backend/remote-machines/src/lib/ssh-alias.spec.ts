import { listSshAliases, validateSshAlias } from './ssh-alias';

it('rejects SSH option injection and invalid aliases', () => {
  for (const alias of ['-oProxyCommand=evil', '-host', 'a b', 'a/b', '*'])
    expect(() => validateSshAlias(alias)).toThrow();
  expect(validateSshAlias('host_1.example')).toBe('host_1.example');
});

it('lists concrete Host aliases', async () => {
  const read = jest.fn(
    async () => 'Host dev *.example test-2\nHost ? one\nHostName ignored\n',
  );
  expect(await listSshAliases(read, '/home/test')).toEqual([
    'dev',
    'test-2',
    'one',
  ]);
  expect(read).toHaveBeenCalledWith('/home/test/.ssh/config', 'utf8');
});

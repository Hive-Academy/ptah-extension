import { workerPaths } from './paths';

describe('workerPaths', () => {
  it('places worker files under the injected home directory', () => {
    expect(workerPaths('/home/test').tokens).toBe(
      '/home/test/.ptah/worker/tokens.json',
    );
    expect(workerPaths('/home/test').adminKey).toBe(
      '/home/test/.ptah/worker/admin.key',
    );
  });
});

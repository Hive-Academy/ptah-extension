import { claudeDomain } from './claude-domain';

describe('claudeDomain', () => {
  it('should work', () => {
    expect(claudeDomain()).toEqual('claude-domain');
  });
});

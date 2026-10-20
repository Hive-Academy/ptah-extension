import 'reflect-metadata';
import { attachCliHostAttention } from './container';

describe('CLI container attention attach', () => {
  it.each(['resolve', 'attach'] as const)('logs %s failure by name and continues', (stage) => {
    const warn = jest.fn();
    const attach = jest.fn(() => ({ dispose: jest.fn() }));
    const resolve = () => {
      if (stage === 'resolve') throw new TypeError('secret');
      return { observe: jest.fn() };
    };
    if (stage === 'attach') attach.mockImplementation(() => { throw new TypeError('secret'); });
    expect(attachCliHostAttention(resolve, attach, warn)).toBeUndefined();
    const nextBootStep = jest.fn();
    nextBootStep();
    expect(nextBootStep).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Host attention attach failed: TypeError');
    expect(warn.mock.calls.join(' ')).not.toContain('secret');
  });
});

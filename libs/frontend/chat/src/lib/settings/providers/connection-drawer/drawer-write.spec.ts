import type { ProvidersSettingsCommit } from '@ptah-extension/core';
import {
  DRAWER_WRITE_BROKEN, DRAWER_WRITE_NO_CONTEXT, DRAWER_WRITE_REFUSED, runDrawerWrite, type DrawerWriteOutcome,
} from './drawer-write';

const idle: ProvidersSettingsCommit = { status: 'idle', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null };
const CONTEXT = { scopeKey: 'workspace', activePath: '/workspace' };

describe('runDrawerWrite', () => {
  let commit: ProvidersSettingsCommit;
  let published: DrawerWriteOutcome[];
  const state = { reviewContext: () => CONTEXT as typeof CONTEXT | null, commit: () => commit };
  beforeEach(() => { commit = { ...idle, status: 'saved', saved: ['Earlier field'] }; published = []; });
  const publish = (outcome: DrawerWriteOutcome) => published.push(outcome);

  it('publishes saving, then the commit THIS write left', async () => {
    await runDrawerWrite(state, async (context) => {
      expect(context).toBe(CONTEXT);
      commit = { ...idle, status: 'failed', message: 'Stored key was not saved.' };
      return true;
    }, publish);
    expect(published).toEqual([{ status: 'saving', message: null }, { status: 'failed', message: 'Stored key was not saved.' }]);
  });

  it('a refused write never reports the earlier saved commit (D15)', async () => {
    await runDrawerWrite(state, async () => false, publish);
    expect(published.at(-1)).toEqual({ status: 'blocked', message: DRAWER_WRITE_REFUSED });
  });

  it('a rejected write is not left at saving', async () => {
    await runDrawerWrite(state, async () => { throw new Error('boom'); }, publish);
    expect(published.at(-1)).toEqual({ status: 'blocked', message: DRAWER_WRITE_BROKEN });
  });

  it('without an edit context nothing is written', async () => {
    const write = jest.fn(async () => true);
    await runDrawerWrite({ ...state, reviewContext: () => null }, write, publish);
    expect(write).not.toHaveBeenCalled();
    expect(published).toEqual([{ status: 'blocked', message: DRAWER_WRITE_NO_CONTEXT }]);
  });
});

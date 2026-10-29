import { commitToast } from './settings-commit-toast';

describe('commitToast', () => {
  it('says nothing while a write has not ended', () => {
    expect(commitToast({ status: 'idle', message: null })).toBeNull();
    expect(commitToast({ status: 'saving', message: null }, 'Saved.')).toBeNull();
  });

  it('a saved write uses its own saved copy as a status', () => {
    expect(commitToast({ status: 'saved', message: null }, 'Key replaced.')).toEqual({ message: 'Key replaced.', tone: 'status' });
  });

  it('a single write that did not save leads with "Not saved." or "Save not confirmed.", then the host message', () => {
    expect(commitToast({ status: 'failed', message: 'Switch the main agent first.' }, 'Saved.'))
      .toEqual({ message: 'Not saved. Switch the main agent first.', tone: 'alert' });
    expect(commitToast({ status: 'blocked', message: null })).toEqual({ message: 'Not saved.', tone: 'alert' });
    expect(commitToast({ status: 'unconfirmed', message: null })).toEqual({ message: 'Save not confirmed.', tone: 'alert' });
  });

  it('a commit with field lists names them in one sentence; a failure never reads as saved', () => {
    expect(commitToast({ status: 'partial', message: 'Retry.', saved: ['A'], unsaved: ['B'], unconfirmed: ['C'] })).toEqual({
      message: 'Saved: A. Not saved: B. Not confirmed: C. Check the current values before retrying. Retry.',
      tone: 'alert',
    });
    expect(commitToast({ status: 'saved', message: null, saved: ['A'], unsaved: [], unconfirmed: [] }))
      .toEqual({ message: 'Saved: A.', tone: 'status' });
  });

  it('a saved commit with nothing to name says nothing', () => {
    expect(commitToast({ status: 'saved', message: null, saved: [], unsaved: [], unconfirmed: [] })).toBeNull();
  });
});

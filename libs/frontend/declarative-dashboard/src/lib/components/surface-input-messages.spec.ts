import { SURFACE_LIMITS, type SurfaceInput } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { InputNode } from '../view-model/view-model.types';
import {
  committedInputValue,
  describedByOf,
  displayedInputValue,
  inputErrorText,
  issueIdOf,
  issueTextsOf,
  plainText,
} from './surface-input-messages';

const text: InputNode = { id: 'reason', kind: 'text', label: 'Reason', path: 'form.reason', selectable: false,
  hostValue: 'host', hints: { required: true, maxLength: 5 } };

describe('surface-input-messages', () => {
  it('reads plain text only from a rich-text object', () => {
    expect(plainText({ text: '<b>x</b>' })).toBe('<b>x</b>');
    expect(plainText({ text: 3 })).toBeUndefined();
    expect(plainText('text')).toBeUndefined();
    expect(plainText(null)).toBeUndefined();
  });

  it('shows the draft over the pending overlay over the host value (Rule 4)', () => {
    const pending = new Map([['form.reason', 'pending']]);
    expect(displayedInputValue(text, { reason: 'draft' }, pending)).toBe('draft');
    expect(displayedInputValue(text, {}, pending)).toBe('pending');
    expect(displayedInputValue(text, {}, new Map())).toBe('host');
    expect(committedInputValue(text, pending)).toBe('pending');
    expect(committedInputValue(text, new Map())).toBe('host');
  });

  it('keeps the host-read error until a draft replaces it, then validates the displayed value', () => {
    const unreadable: InputNode = { ...text, hostValue: '', draftError: 'Unreadable value.' };
    expect(inputErrorText(unreadable, {}, '')).toBe('Unreadable value.');
    expect(inputErrorText(unreadable, { reason: 'ok' }, 'ok')).toBeUndefined();
    const tooLong = 'x'.repeat(SURFACE_LIMITS.maxStringLength + 1);
    expect(inputErrorText(text, { reason: tooLong }, tooLong)).toEqual(expect.any(String));
    // Required and length hints are submit-time checks, not draft errors.
    expect(inputErrorText(text, {}, '')).toBeUndefined();
    expect(inputErrorText(text, {}, 42)).toEqual(expect.any(String));
  });

  it('validates against the node it is given, such as sanitized choice options', () => {
    const select: InputNode = { id: 'env', kind: 'select', label: 'Env', path: 'form.env', selectable: false,
      hostValue: null, options: [{ value: 'a', label: 'A' }] };
    const narrowed: SurfaceInput = { ...select, kind: 'select', options: [] };
    expect(inputErrorText(select, { env: 'a' }, 'a')).toBeUndefined();
    expect(inputErrorText(select, { env: 'a' }, 'a', narrowed)).toEqual(expect.any(String));
  });

  it('keeps string issues for the component and drops everything else', () => {
    const issues = new Map<string, readonly string[]>([['reason', ['One', 2 as unknown as string, 'Two']],
      ['other', ['Not mine']], ['broken', 'no' as unknown as readonly string[]]]);
    expect(issueTextsOf(issues, 'reason')).toEqual(['One', 'Two']);
    expect(issueTextsOf(issues, 'broken')).toEqual([]);
    expect(issueTextsOf(issues, 'missing')).toEqual([]);
  });

  it('orders aria-describedby as hint, error, issues and returns null when empty', () => {
    expect(describedByOf('c', { hintId: 'c-hint', errorId: 'c-error', issueCount: 2 }))
      .toBe(`c-hint c-error ${issueIdOf('c', 0)} ${issueIdOf('c', 1)}`);
    expect(describedByOf('c', { issueCount: 1 })).toBe('c-issue-0');
    expect(describedByOf('c', { issueCount: 0 })).toBeNull();
  });
});

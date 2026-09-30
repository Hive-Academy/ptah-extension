import { I18nError } from './i18n.error';

describe('I18nError', () => {
  it('is an Error with its own name and message', () => {
    const error = new I18nError('[i18n] broken');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(I18nError);
    expect(error.name).toBe('I18nError');
    expect(error.message).toBe('[i18n] broken');
  });

  it('keeps the cause it was given', () => {
    const cause = new Error('underlying');
    expect(new I18nError('[i18n] wrapped', { cause }).cause).toBe(cause);
  });
});

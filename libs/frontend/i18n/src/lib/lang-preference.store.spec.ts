import { LangPreferenceStore } from './lang-preference.store';

const KEY = 'test.lang';

describe('LangPreferenceStore', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
  });

  describe('in the browser', () => {
    const store = new LangPreferenceStore(KEY, true);

    it('returns null when nothing is stored', () => {
      expect(store.read()).toBeNull();
    });

    it('round-trips a supported language under the configured key', () => {
      store.write('ar');
      expect(localStorage.getItem(KEY)).toBe('ar');
      expect(store.read()).toBe('ar');
    });

    it.each(['xx', 'AR', 'ar-EG', ''])(
      'treats an invalid stored value %p as absent',
      (value) => {
        localStorage.setItem(KEY, value);
        expect(store.read()).toBeNull();
      },
    );

    it('returns null when getItem throws', () => {
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      expect(store.read()).toBeNull();
    });

    it('swallows a setItem failure', () => {
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
      expect(() => store.write('ar')).not.toThrow();
    });

    it('survives a localStorage accessor that throws (hardened browsers)', () => {
      jest.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      expect(store.read()).toBeNull();
      expect(() => store.write('en')).not.toThrow();
    });
  });

  describe('on the server', () => {
    const store = new LangPreferenceStore(KEY, false);

    it('never touches storage', () => {
      localStorage.setItem(KEY, 'ar');
      const getItem = jest.spyOn(Storage.prototype, 'getItem');
      const setItem = jest.spyOn(Storage.prototype, 'setItem');

      expect(store.read()).toBeNull();
      store.write('en');

      expect(getItem).not.toHaveBeenCalled();
      expect(setItem).not.toHaveBeenCalled();
    });
  });
});

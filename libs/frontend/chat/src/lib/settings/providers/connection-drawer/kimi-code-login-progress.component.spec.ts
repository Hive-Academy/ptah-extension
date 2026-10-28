import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { KimiCodeLoginState } from '@ptah-extension/shared';
import { KimiCodeLoginProgressComponent } from './kimi-code-login-progress.component';

describe('KimiCodeLoginProgressComponent', () => {
  let fixture: ComponentFixture<KimiCodeLoginProgressComponent>;

  const render = async (state: KimiCodeLoginState | null) => {
    fixture.componentRef.setInput('state', state);
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const status = () =>
    (fixture.nativeElement as HTMLElement).querySelector('[data-testid="kimi-login-status"]')?.textContent?.trim() ?? '';

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [KimiCodeLoginProgressComponent] });
    fixture = TestBed.createComponent(KimiCodeLoginProgressComponent);
  });
  afterEach(() => TestBed.resetTestingModule());

  // The contract promises fixed host copy, but the view is a second line of defence: a host
  // `error` string is never rendered, only the local copy keyed by status and `errorCode`.
  it('never renders host error text for a failure with a code', async () => {
    await render({ status: 'failed', errorCode: 'timeout', error: 'fake-secret-text' });
    expect(status()).toBe('Kimi Code sign-in timed out.');
    expect(text()).not.toContain('fake-secret-text');
  });

  it('never renders host error text for a failure without a code', async () => {
    await render({ status: 'failed', error: 'fake-secret-text' });
    expect(status()).toBe('Kimi Code sign-in could not be completed. Retry.');
    expect(text()).not.toContain('fake-secret-text');
  });

  it('never renders host error text for a cancelled sign-in', async () => {
    await render({ status: 'cancelled', error: 'fake-secret-text' });
    expect(status()).toBe('Sign-in cancelled.');
    expect(text()).not.toContain('fake-secret-text');
  });

  it('shows nothing before a sign-in ran or after it succeeded', async () => {
    await render(null);
    expect(text().trim()).toBe('');
    await render({ status: 'succeeded', error: 'fake-secret-text' });
    expect(text().trim()).toBe('');
  });
});

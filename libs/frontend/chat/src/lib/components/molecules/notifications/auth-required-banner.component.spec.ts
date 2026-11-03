import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { AuthRequiredBannerComponent } from './auth-required-banner.component';

interface BannerInputs {
  message?: string;
  providerId?: string | null;
  carryOverProvider?: string | null;
  carryOverBusy?: boolean;
}

describe('AuthRequiredBannerComponent', () => {
  let fixture: ComponentFixture<AuthRequiredBannerComponent>;

  function render(inputs: BannerInputs): HTMLElement {
    TestBed.configureTestingModule({
      imports: [AuthRequiredBannerComponent],
    });
    fixture = TestBed.createComponent(AuthRequiredBannerComponent);
    fixture.componentRef.setInput(
      'message',
      inputs.message ?? 'Session was created with another provider.',
    );
    fixture.componentRef.setInput('providerId', inputs.providerId ?? null);
    if (inputs.carryOverProvider !== undefined) {
      fixture.componentRef.setInput(
        'carryOverProvider',
        inputs.carryOverProvider,
      );
    }
    if (inputs.carryOverBusy !== undefined) {
      fixture.componentRef.setInput('carryOverBusy', inputs.carryOverBusy);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const buttons = (host: HTMLElement): HTMLButtonElement[] =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('button'));

  const carryOverButton = (host: HTMLElement): HTMLButtonElement | undefined =>
    buttons(host).find((b) => b.textContent?.includes('Continue with'));

  /** The existing buttons' shape, which the carry-over must leave alone. */
  const describeButton = (b: HTMLButtonElement) => ({
    text: b.textContent?.trim(),
    ariaLabel: b.getAttribute('aria-label'),
    className: b.className,
    disabled: b.disabled,
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing without a message', () => {
    const host = render({ message: '' });
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("renders today's banner without a carry-over provider (AC 1.2, 1.3)", () => {
    const host = render({ providerId: 'anthropic' });

    expect(carryOverButton(host)).toBeUndefined();
    expect(host.querySelector('.sr-only')).toBeNull();
    expect(host.querySelector('[aria-describedby]')).toBeNull();
    expect(buttons(host).map(describeButton)).toEqual([
      {
        text: 'Open Settings',
        ariaLabel: 'Open Settings',
        className: 'btn btn-xs btn-primary gap-0.5 px-2',
        disabled: false,
      },
      {
        text: '',
        ariaLabel: 'Dismiss',
        className: 'btn btn-xs btn-ghost px-1',
        disabled: false,
      },
    ]);
  });

  it('keeps the Codex re-auth label without a carry-over provider', () => {
    const host = render({ providerId: 'openai-codex' });
    expect(buttons(host).map((b) => b.textContent?.trim())).toEqual([
      'Re-authenticate in terminal',
      '',
    ]);
  });

  it('places the carry-over button first and leaves the existing buttons unchanged', () => {
    const plain = render({ providerId: 'anthropic' });
    const before = buttons(plain).map(describeButton);
    TestBed.resetTestingModule();

    const host = render({
      providerId: 'anthropic',
      carryOverProvider: 'Codex',
    });
    const all = buttons(host);

    expect(all).toHaveLength(3);
    expect(all[0]).toBe(carryOverButton(host));
    expect(all.slice(1).map(describeButton)).toEqual(before);
  });

  it('is a native button whose visible label is its accessible name', () => {
    const host = render({ carryOverProvider: 'Codex' });
    const button = carryOverButton(host);

    expect(button).toBeDefined();
    expect(button?.getAttribute('type')).toBe('button');
    expect(button?.hasAttribute('aria-label')).toBe(false);
    expect(button?.textContent?.trim()).toBe('Continue with Codex');
  });

  it('describes the transfer of the conversation text to the provider (AC 8.4)', () => {
    const host = render({ carryOverProvider: 'Codex' });
    const button = carryOverButton(host);
    const describedBy = button?.getAttribute('aria-describedby');

    expect(describedBy).toBeTruthy();
    const description = host.querySelector(`[id="${describedBy}"]`);
    expect(description).not.toBeNull();
    expect(description?.classList.contains('sr-only')).toBe(true);
    expect(description?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      "Sends this conversation's text to Codex to start a new chat from a " +
        'summary. Tool input, tool output and attachments are not sent, and ' +
        'known secrets are redacted.',
    );
  });

  it('gives each banner instance its own description id', () => {
    const first = render({ carryOverProvider: 'Codex' });
    const firstId = carryOverButton(first)?.getAttribute('aria-describedby');
    const second = TestBed.createComponent(AuthRequiredBannerComponent);
    second.componentRef.setInput('message', 'Refused.');
    second.componentRef.setInput('carryOverProvider', 'Codex');
    second.detectChanges();
    const secondId = carryOverButton(
      second.nativeElement as HTMLElement,
    )?.getAttribute('aria-describedby');

    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(firstId);
  });

  it('is enabled and not busy by default', () => {
    const host = render({ carryOverProvider: 'Codex' });
    const button = carryOverButton(host);

    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute('aria-busy')).toBe('false');
    expect(button?.querySelector('.loading')).toBeNull();
  });

  it('is disabled and busy while a carry-over is starting', () => {
    const host = render({ carryOverProvider: 'Codex', carryOverBusy: true });
    const button = carryOverButton(host);

    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(button?.textContent?.trim()).toBe('Continue with Codex');
    expect(
      button?.querySelector('.loading')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('emits carryOver once per click and nothing else', () => {
    const host = render({ carryOverProvider: 'Codex' });
    const carryOver = jest.fn();
    const reauth = jest.fn();
    const dismiss = jest.fn();
    fixture.componentInstance.carryOver.subscribe(carryOver);
    fixture.componentInstance.reauth.subscribe(reauth);
    fixture.componentInstance.dismiss.subscribe(dismiss);

    carryOverButton(host)?.click();

    expect(carryOver).toHaveBeenCalledTimes(1);
    expect(reauth).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('does not emit carryOver while busy', () => {
    const host = render({ carryOverProvider: 'Codex', carryOverBusy: true });
    const carryOver = jest.fn();
    fixture.componentInstance.carryOver.subscribe(carryOver);

    carryOverButton(host)?.click();

    expect(carryOver).not.toHaveBeenCalled();
  });

  it('keeps the existing actions emitting with a carry-over provider', () => {
    const host = render({ carryOverProvider: 'Codex' });
    const reauth = jest.fn();
    const dismiss = jest.fn();
    const carryOver = jest.fn();
    fixture.componentInstance.reauth.subscribe(reauth);
    fixture.componentInstance.dismiss.subscribe(dismiss);
    fixture.componentInstance.carryOver.subscribe(carryOver);

    const [, reauthButton, dismissButton] = buttons(host);
    reauthButton.click();
    dismissButton.click();

    expect(reauth).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(carryOver).not.toHaveBeenCalled();
  });

  it('removes the button when the provider is cleared', () => {
    const host = render({ carryOverProvider: 'Codex' });
    expect(carryOverButton(host)).toBeDefined();

    fixture.componentRef.setInput('carryOverProvider', null);
    fixture.detectChanges();

    expect(carryOverButton(host)).toBeUndefined();
    expect(host.querySelector('.sr-only')).toBeNull();
  });
});

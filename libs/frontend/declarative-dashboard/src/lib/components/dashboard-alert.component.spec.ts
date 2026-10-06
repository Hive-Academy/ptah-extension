import { TestBed } from '@angular/core/testing';
import { DashboardAlertComponent, type AlertNode } from './dashboard-alert.component';

describe('DashboardAlertComponent', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const node: AlertNode = { id: 'alert', kind: 'alert', tone: 'info',
    text: { text: 'Disk almost full' }, selectable: false };
  /** Both theme roots the webview ships: dark anubis and light anubis-light. */
  const themeRoots = ['anubis', 'anubis-light'] as const;
  const toneStyles = {
    info: {
      root: 'alert border border-info bg-base-200 text-base-content',
      icon: 'h-4 w-4 shrink-0 text-info',
      label: 'Info',
      role: 'status',
    },
    success: {
      root: 'alert border border-success bg-base-200 text-base-content',
      icon: 'h-4 w-4 shrink-0 text-success',
      label: 'Success',
      role: 'status',
    },
    warning: {
      root: 'alert border border-warning bg-base-200 text-base-content',
      icon: 'h-4 w-4 shrink-0 text-warning',
      label: 'Warning',
      role: 'alert',
    },
    error: {
      root: 'alert border border-error bg-base-200 text-base-content',
      icon: 'h-4 w-4 shrink-0 text-error',
      label: 'Error',
      role: 'alert',
    },
  } as const;
  function setup(value: AlertNode = node) {
    const fixture = TestBed.createComponent(DashboardAlertComponent);
    fixture.componentRef.setInput('node', value);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    return { fixture, element };
  }
  it('renders every tone on a neutral surface with an exact class string, a hidden icon and a visible tone label, under both theme roots', () => {
    for (const tone of ['info', 'success', 'warning', 'error'] as const) {
      const { fixture, element } = setup({ ...node, tone });
      const alert = element.querySelector(`[role="${toneStyles[tone].role}"]`)!;
      for (const theme of themeRoots) {
        element.setAttribute('data-theme', theme);
        fixture.detectChanges();
        // Ivy writes the class set in its own order; the complete literal in the
        // component source is what Tailwind scans, so compare the exact set.
        expect(alert.className.split(/\s+/).sort().join(' ')).toBe(toneStyles[tone].root.split(/\s+/).sort().join(' ')); // neutral surface; text stays base-content (S2)
        expect(alert.getAttribute('role')).toBe(toneStyles[tone].role);
        const icon = alert.querySelector<SVGElement>('svg')!;
        expect(icon.className.baseVal.split(/\s+/).sort().join(' ')).toBe(toneStyles[tone].icon.split(/\s+/).sort().join(' ')); // tone accent, complete literal
        expect(icon.getAttribute('aria-hidden')).toBe('true');
        expect(element.querySelector('.sr-only')).toBeNull(); // the tone word is visible now (S3)
        const label = alert.querySelector<HTMLElement>('[data-testid="alert-tone"]')!;
        expect(label.textContent).toBe(toneStyles[tone].label);
        expect(label.classList).toContain('font-semibold');
        expect(alert.textContent).toContain('Disk almost full');
      }
      expect(element.querySelector(`[role="${toneStyles[tone].role === 'alert' ? 'status' : 'alert'}"]`)).toBeNull();
    }
  });
  it('interpolates text only: agent markup never becomes markup, style or colour', () => {
    const { element } = setup({ ...node, text: { text: hostile } });
    expect(element.querySelector('img, style, [style], script')).toBeNull();
    expect(element.textContent).toContain(hostile);
    const classes = element.querySelector('[role]')!.className;
    expect(/#([0-9a-f]{3,8})|text-(red|blue|green|yellow|slate|gray|zinc)-/.test(classes)).toBe(false);
  });
  it('renders one compact line without a title, and puts an inline title after the tone label and before the text with one', () => {
    const { element } = setup();
    const bare = element.querySelector('[role]')!;
    expect(element.querySelector('[data-testid="alert-title"]')).toBeNull(); // no empty placeholder
    expect(bare.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
    expect(bare.children.length).toBe(2); // icon svg + tone label: one line, no title node
    expect(bare.textContent).toContain('Info Disk almost full');
    expect(bare.textContent!.indexOf('Info')).toBeLessThan(bare.textContent!.indexOf('Disk almost full'));
    const titled = setup({ ...node, tone: 'warning', title: { text: 'Deploy failed' } }).element;
    const alert = titled.querySelector('[role="alert"]')!;
    const title = titled.querySelector<HTMLElement>('[data-testid="alert-title"]')!;
    expect(title.textContent).toContain('Deploy failed');
    expect(title.classList).toContain('font-semibold');
    expect(title.parentElement).toBe(alert); // same element, not a sibling heading
    const order = ['Warning', 'Deploy failed', 'Disk almost full'].map((part) => alert.textContent!.indexOf(part));
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    expect(alert.textContent).toContain('Warning Deploy failed Disk almost full'); // label, title, text: one note
    expect(alert.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
  });
});
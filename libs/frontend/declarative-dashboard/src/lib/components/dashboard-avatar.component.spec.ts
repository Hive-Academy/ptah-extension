import { TestBed } from '@angular/core/testing';
import type { AvatarNode } from '../view-model/view-model.types';
import { AVATAR_TONES, avatarInitials, avatarTone, DashboardAvatarComponent } from './dashboard-avatar.component';

describe('DashboardAvatarComponent', () => {
  const node: AvatarNode = { id: 'agent', kind: 'avatar', name: 'code-explorer', subtitle: '48.1k tokens', selectable: false };
  function setup(value: AvatarNode = node) {
    const fixture = TestBed.createComponent(DashboardAvatarComponent);
    fixture.componentRef.setInput('node', value);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    return { fixture, element };
  }
  const disc = (element: HTMLElement) => element.querySelector<HTMLElement>('[data-testid="avatar-initials"]')!;

  it('shows initials in a decorative disc and the name and subtitle as text (R4.5)', () => {
    const { element } = setup();
    expect(disc(element).textContent).toBe('CE');
    expect(disc(element).getAttribute('aria-hidden')).toBe('true');
    expect(element.querySelector('[data-testid="avatar-name"]')?.textContent).toBe('code-explorer');
    expect(element.querySelector('[data-testid="avatar-subtitle"]')?.textContent).toBe('48.1k tokens');
  });

  it('omits the subtitle line when there is none', () => {
    const { element } = setup({ id: 'agent', kind: 'avatar', name: 'planner', selectable: false });
    expect(element.querySelector('[data-testid="avatar-subtitle"]')).toBeNull();
    expect(disc(element).textContent).toBe('Pl');
  });

  it('never renders an image, link, style or control; hostile text stays literal (R4.5)', () => {
    const hostile = '<img src=x onerror=alert(1)> https://evil.example/a.png';
    const { element } = setup({ id: 'agent', kind: 'avatar', name: hostile, subtitle: '<script>x</script>', selectable: true });
    expect(element.querySelectorAll('img, svg image, script, style, [style], a, button, [src], [href]')).toHaveLength(0);
    expect(element.querySelector('[data-testid="avatar-name"]')?.textContent).toBe(hostile);
    expect(element.querySelector('[data-testid="avatar-subtitle"]')?.textContent).toBe('<script>x</script>');
  });

  it('picks a deterministic tone from the name over neutral, info, success and warning', () => {
    const names = ['code-explorer', 'planner', 'code-reviewer', 'tester', 'a', 'Zoë', '日本'];
    for (const name of names) {
      expect(AVATAR_TONES).toContain(avatarTone(name));
      expect(avatarTone(name)).toBe(avatarTone(name));
      const { element } = setup({ id: name, kind: 'avatar', name, selectable: false });
      expect(disc(element).className).toBe(`dp-avatar dp-avatar--${avatarTone(name)}`);
    }
    const tones = new Set(Array.from({ length: 40 }, (_, index) => avatarTone(`agent-${index}`)));
    expect(tones.size).toBe(AVATAR_TONES.length);
  });

  it('derives at most two initials without splitting a code point', () => {
    expect(avatarInitials('Ada Lovelace King')).toBe('AL');
    expect(avatarInitials('  planner  ')).toBe('Pl');
    expect(avatarInitials('x')).toBe('X');
    expect(avatarInitials('snake_case.name')).toBe('SC');
    expect(avatarInitials('--')).toBe('--');
    expect(avatarInitials('😀😃 agent')).toBe('😀A');
    expect(avatarInitials('😀')).toBe('😀');
  });
});

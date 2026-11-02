import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MOTION_STYLE, MOTION_STYLES } from '@ptah-extension/core';

const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');
const motion = css.slice(css.indexOf("[data-motion-style='fade']"), css.indexOf('/* ============================================================================\nACCESSIBILITY STYLES'));

describe('motion preset CSS contract', () => {
  it('finishes a panel entrance during the root crossfade without resetting its animation name', () => {
    const selector = 'html.ptah-vt-active :is(.ptah-motion-enter, .ptah-pane-switch-enter, .inspector-stats-enter)';
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThan(-1);
    const ruleText = css.slice(start, css.indexOf('}', start) + 1);
    const style = document.createElement('style');
    style.textContent = `.ptah-motion-enter { animation-name: ptahMotionEnter; animation-duration: 400ms; animation-delay: 0s; animation-iteration-count: 1; }\n${ruleText}`;
    const panel = document.createElement('div');
    panel.className = 'ptah-motion-enter';
    document.head.append(style);
    document.body.append(panel);
    try {
      const before = getComputedStyle(panel);
      document.documentElement.classList.add('ptah-vt-active');
      const during = getComputedStyle(panel);
      document.documentElement.classList.remove('ptah-vt-active');
      const after = getComputedStyle(panel);

      // jsdom may not resolve :is() and !important in the computed cascade.
      // In that case, inspect the parsed CSSOM declarations rather than source text.
      const suppression = Array.from(style.sheet?.cssRules ?? []).find(
        (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === selector,
      );
      expect(suppression).toBeDefined();
      expect(suppression?.style.getPropertyValue('animation-duration').trim()).toBe('0.01ms');
      expect(suppression?.style.getPropertyPriority('animation-duration')).toBe('important');
      expect(suppression?.style.getPropertyValue('animation-delay').trim()).toBe('0s');
      expect(suppression?.style.getPropertyValue('animation-iteration-count').trim()).toBe('1');
      expect(suppression?.style.getPropertyValue('animation-name')).toBe('');

      if (during.animationDuration === '0.01ms') {
        expect(before.animationName).toBe('ptahMotionEnter');
        expect(during.animationName).toBe('ptahMotionEnter');
        expect(after.animationName).toBe('ptahMotionEnter');
        expect(after.animationDuration).toBe('400ms');
      }
    } finally {
      document.documentElement.classList.remove('ptah-vt-active');
      panel.remove();
      style.remove();
    }
  });
  it('defines all six selector blocks and keeps rise as the attribute-free default', () => {
    expect(DEFAULT_MOTION_STYLE).toBe('rise');
    expect(MOTION_STYLES).toHaveLength(6);
    for (const style of MOTION_STYLES) {
      expect(motion).toContain(`[data-motion-style='${style}'] {`);
    }
    expect(css).toMatch(/:root\s*\{[\s\S]*?--ptah-motion-enter-y:\s*18px/);
    expect(motion).not.toContain('!important');
  });

  it('uses the shared durations and overlaps a positioned leave with its entering replacement', () => {
    expect(motion).toMatch(/:where\(\.ptah-motion-stage\)\s*\{\s*position:\s*relative/);
    expect(motion).toMatch(/\.ptah-motion-enter\s*\{\s*animation:\s*ptahMotionEnter var\(--ptah-motion-in\)/);
    expect(motion).toMatch(/\.ptah-motion-leave\s*\{[^}]*animation:\s*ptahMotionLeave var\(--ptah-motion-out\)/);
    expect(motion).toMatch(/\.ptah-motion-stage\s*>\s*\.ptah-motion-leave\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*z-index:\s*1;/);
    const globalLeave = motion.match(/(?:^|\n)\.ptah-motion-leave\s*\{[^}]+\}/)?.[0];
    expect(globalLeave).toBeDefined();
    expect(globalLeave).not.toMatch(/position:|inset:|z-index:/);
    expect(motion).toMatch(/@keyframes ptahMotionEnter\s*\{[\s\S]*?28%\s*\{\s*opacity:\s*0\.8;[\s\S]*?56\.25%\s*\{\s*opacity:\s*0\.94;/);
    expect(motion).toMatch(/@keyframes ptahMotionLeave\s*\{[\s\S]*?75%\s*\{\s*opacity:\s*1;/);
    expect(motion).toMatch(/\[data-motion-clone='pending'\]\s*\{\s*animation-play-state:\s*paused/);
    expect(motion).toContain(".ptah-motion-stage[data-motion-dir='back']");
  });

  it('uses transform-only glass entrances and cuts glass exits', () => {
    const glassEnterFrame = motion.match(/@keyframes ptahMotionEnterGlass\s*\{[\s\S]*?\n\}/)?.[0];
    expect(glassEnterFrame).toContain('transform:');
    expect(glassEnterFrame).not.toMatch(/\bopacity\s*:/);
    expect(motion).toMatch(/:root\[data-glass='on'\] \.ptah-motion-panel\.ptah-motion-enter:is\([^}]+\{\s*animation-name:\s*ptahMotionEnterGlass/);
    expect(motion).toMatch(/:root\[data-glass='on'\] \.ptah-motion-panel\.ptah-motion-leave:not\(ptah-native-drawer\):is\([^}]+\{\s*animation:\s*none;\s*display:\s*none/);
    expect(motion).toContain(':has([data-glass-surface]');
    expect(motion).toContain(":root[data-glass='on'][data-motion-style='fade'] .ptah-motion-panel.ptah-motion-enter");
    expect(motion).toContain(":root[data-glass='on'] [data-motion-style='fade'] .ptah-motion-panel.ptah-motion-enter");
    expect(motion).toContain(":root[data-glass='on'][data-motion-style='scale'] .ptah-motion-panel.ptah-motion-enter");
    expect(motion).toContain(":root[data-glass='on'] [data-motion-style='scale'] .ptah-motion-panel.ptah-motion-enter");
    expect(motion).not.toMatch(/(?:^|\n)\.ptah-motion-panel\.ptah-motion-(?:enter|leave):is\(/);
  });

  it('animates only the native drawer panel on host leave', () => {
    const drawerRule = motion.match(/ptah-native-drawer\.ptah-motion-leave \.ptah-drawer-panel\s*\{[^}]+\}/)?.[0];
    expect(drawerRule).toMatch(/animation:\s*ptahMotionLeave var\(--ptah-motion-out\) var\(--ptah-ease-gentle-in\) forwards/);
    expect(drawerRule).not.toContain('backdrop');
    expect(motion).not.toMatch(/ptah-native-drawer\.ptah-motion-leave \.ptah-drawer-backdrop/);
    expect(motion).toContain('.ptah-motion-leave:not(ptah-native-drawer)');
    expect(motion).toMatch(/:root\[data-glass='on'\] ptah-native-drawer\.ptah-motion-leave \.ptah-drawer-panel\s*\{\s*animation:\s*none;\s*display:\s*none;/);
  });

  it('hides exits and clones under reduced motion and keeps the root snapshot a plain crossfade', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.ptah-motion-leave,\s*\[data-motion-clone\]\s*\{\s*display:\s*none/);
    const rootFrame = css.match(/@keyframes ptahPageIn\s*\{[\s\S]*?\n\}/)?.[0];
    expect(rootFrame).toContain('opacity: 0');
    expect(rootFrame).toContain('opacity: 1');
    expect(rootFrame).not.toContain('transform');
  });
});

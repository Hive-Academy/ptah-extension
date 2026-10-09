import { DestroyRef, Injectable, inject, signal } from '@angular/core';

export interface MermaidThemeVariables {
  readonly background: string;
  readonly mainBkg: string;
  readonly primaryColor: string;
  readonly primaryTextColor: string;
  readonly primaryBorderColor: string;
  readonly lineColor: string;
  readonly secondaryColor: string;
  readonly tertiaryColor: string;
}

/** One observer for all diagrams; each diagram reacts to the shared revision. */
@Injectable({ providedIn: 'root' })
export class MermaidThemeService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly revision = signal(0);

  constructor() {
    if (typeof document === 'undefined') return;
    const observer = new MutationObserver(() => this.revision.update((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  variables(): MermaidThemeVariables {
    this.revision();
    return {
      background: themeColor('bg-base-100', '#ffffff'), mainBkg: themeColor('bg-base-100', '#ffffff'),
      primaryColor: themeColor('bg-primary', '#570df8'), primaryTextColor: themeColor('text-base-content', '#1f2937'),
      primaryBorderColor: themeColor('bg-base-300', '#d1d5db'), lineColor: themeColor('text-base-content', '#1f2937'),
      secondaryColor: themeColor('bg-base-200', '#f3f4f6'), tertiaryColor: themeColor('bg-base-300', '#e5e7eb'),
    };
  }
}

function themeColor(className: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const probe = document.createElement('span');
  probe.className = className;
  probe.style.cssText = 'position:absolute;visibility:hidden';
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const color = className.startsWith('text-') ? style.color : style.backgroundColor;
  probe.remove();
  return color || fallback;
}

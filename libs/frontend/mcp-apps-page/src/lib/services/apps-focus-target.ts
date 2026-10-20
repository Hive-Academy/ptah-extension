import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AppsFocusTarget {
  private source: (() => string | null) | null = null;

  public register(source: () => string | null): void {
    this.source = source;
  }

  public currentSessionId(): string | null {
    return this.source?.() ?? null;
  }
}

import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * App - Root application component
 *
 * Complexity Level: 1 (Simple - Pure composition, zero logic)
 *
 * Single Responsibility: Render the LandingPageComponent root
 *
 * SOLID Principles Applied:
 * - ✅ Single Responsibility: Only renders LandingPageComponent
 * - ✅ Composition Over Inheritance: Composes LandingPageComponent
 * - ✅ No logic, no state - pure presentational root
 *
 * Pattern: Minimal Root Component
 * - Delegates all concerns to LandingPageComponent
 * - OnPush change detection for performance
 * - Standalone component architecture
 *
 * @example
 * ```typescript
 * // Bootstrap in main.ts
 * import { App } from './app/app';
 * bootstrapApplication(App, appConfig);
 * ```
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}

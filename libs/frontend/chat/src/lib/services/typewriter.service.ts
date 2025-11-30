import { Injectable } from '@angular/core';
import { concat, from, interval, of } from 'rxjs';
import {
  concatMap,
  delay,
  ignoreElements,
  map,
  repeat,
  take,
} from 'rxjs/operators';

/**
 * TypewriterService - RxJS-based typewriter animation effects
 *
 * Complexity Level: 1 (Simple service)
 * Patterns: Pure RxJS observables, interval-based character reveal
 *
 * Provides typewriter animation effects for streaming text:
 * - Forward typing: Reveal characters from start to end
 * - Backward typing: Remove characters from end to start (erase effect)
 * - Cycling effect: type → pause → erase → pause → repeat
 */
interface TypeParams {
  word: string;
  speed: number;
  backwards?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class TypewriterService {
  /**
   * Type out a word character by character
   * @param word - Text to type
   * @param speed - Milliseconds per character
   * @param backwards - If true, erase from end to start
   */
  type({ word, speed, backwards = false }: TypeParams) {
    return interval(speed).pipe(
      map((x) =>
        backwards
          ? word.substring(0, word.length - x)
          : word.substring(0, x + 1)
      ),
      take(word.length)
    );
  }

  /**
   * Type effect cycle: type → pause → erase → pause
   * @param word - Text to animate
   */
  typeEffect(word: string) {
    return concat(
      this.type({ word, speed: 50 }),
      of('').pipe(delay(1200), ignoreElements()),
      this.type({ word, speed: 30, backwards: true }),
      of('').pipe(delay(300), ignoreElements())
    );
  }

  /**
   * Cycle through multiple titles with typewriter effect
   * @param titles - Array of strings to cycle through
   */
  getTypewriterEffect(titles: string[]) {
    return from(titles).pipe(
      concatMap((title) => this.typeEffect(title)),
      repeat()
    );
  }
}

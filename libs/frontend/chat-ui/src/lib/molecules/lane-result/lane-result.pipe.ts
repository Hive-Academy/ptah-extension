import { Pipe, type PipeTransform } from '@angular/core';
import {
  parseLaneResult,
  type LaneResult,
} from '../../utils/lane-result.utils';

/**
 * `text | laneResult` — the trailing lane result of an agent message, or
 * `null`. Pure, so a template re-parses only when the text changes.
 */
@Pipe({ name: 'laneResult', standalone: true, pure: true })
export class LaneResultPipe implements PipeTransform {
  transform(text: string | null | undefined): LaneResult | null {
    return parseLaneResult(text ?? '');
  }
}

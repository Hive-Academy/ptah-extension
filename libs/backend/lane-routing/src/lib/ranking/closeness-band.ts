import { CLOSENESS_BAND } from '../routing-constants';

export function insideClosenessBand(top: number, score: number): boolean {
  return top - score <= CLOSENESS_BAND;
}

import { TRIBUNAL_MOVES } from '@ptah-extension/tribunal-panel/phase';

const compound =
  '(?:conditions?|servers?|builds?|tests?|panel|page|view|tab|ui|bugs?|issues?|errors?|crash(?:es)?|components?|files?|code)';
const move = `(?:${TRIBUNAL_MOVES.join('|')})s?\\b(?!\\s+${compound}\\b)`;
const article = '(?:(?:a|an|the|\\d+)\\s+)?';
const launch =
  "(?:run|start|launch|convene|begin|kick\\s+off|spin\\s+up|hold|have|get|call|open|initiate|fire\\s+up|use|do|set\\s+up|let's\\s+(?:do|run|have))";
const movePattern = new RegExp(
  `\\b(?:${launch}\\s+${article}|(?:with|via|using)\\s+${article})${move}`,
  'i',
);
const tribunalPattern = new RegExp(`\\btribunal\\b(?!\\s+${compound}\\b)`, 'i');

export function hasTribunalIntent(content: string): boolean {
  return tribunalPattern.test(content) || movePattern.test(content);
}

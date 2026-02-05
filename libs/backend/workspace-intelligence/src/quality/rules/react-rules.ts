/**
 * React Anti-Pattern Detection Rules
 *
 * Provides rules for detecting common React anti-patterns that
 * can lead to performance issues, bugs, and maintainability problems.
 *
 * Rules included:
 * - Missing key prop in .map() JSX rendering
 * - Direct state mutation (this.state.x = value)
 * - useEffect dependency issues (stale closures)
 * - Large component files (>300 lines)
 * - Inline function props (unnecessary re-renders)
 *
 * TASK_2025_144: Phase E2 - Framework-Specific Anti-Pattern Rules
 *
 * @packageDocumentation
 */

import type { AntiPatternRule, AntiPatternMatch } from '@ptah-extension/shared';
import {
  createRegexRule,
  createHeuristicRule,
  getLineFromPosition,
} from './rule-base';

// ============================================
// React Rules
// ============================================

/**
 * Detects .map() calls in JSX that return elements without key props.
 *
 * React requires unique key props on elements rendered in lists to
 * efficiently reconcile the virtual DOM. Missing keys cause unnecessary
 * re-renders and can lead to subtle bugs with component state.
 *
 * Detection logic:
 * 1. Find .map() calls
 * 2. Check if the returned content contains JSX (< character after map body)
 * 3. Check if a key= or key={ attribute is present in the returned JSX
 * 4. Flag if .map() returns JSX without key
 *
 * @severity warning - Causes React reconciliation issues and warnings
 *
 * @example Detected patterns:
 * ```tsx
 * {items.map(item => <li>{item.name}</li>)}        // Detected: missing key
 * {items.map(item => <li key={item.id}>{item.name}</li>)} // NOT detected
 * ```
 */
export const missingKeyRule: AntiPatternRule = createHeuristicRule({
  id: 'react-missing-key',
  name: 'React Missing Key Prop',
  description: 'Detects .map() calls returning JSX elements without a key prop',
  severity: 'warning',
  category: 'react',
  fileExtensions: ['.tsx', '.jsx'],
  check: (content: string, filePath: string): AntiPatternMatch[] => {
    const matches: AntiPatternMatch[] = [];

    // Find .map( calls that likely return JSX
    // Look for .map(...) followed by content containing < (JSX)
    // This heuristic checks for .map( followed by an arrow function or function returning JSX
    const mapPattern = /\.map\s*\(\s*(?:\([^)]*\)|[a-zA-Z_$]\w*)\s*=>\s*/g;
    let mapMatch: RegExpExecArray | null;

    while ((mapMatch = mapPattern.exec(content)) !== null) {
      // Extract a window of content after the arrow to check for JSX
      const afterArrow = content.substring(
        mapMatch.index + mapMatch[0].length,
        Math.min(content.length, mapMatch.index + mapMatch[0].length + 500)
      );

      // Check if the map body contains JSX (starts with < or has return with <)
      const hasJSX =
        /^(?:\s*\{?\s*(?:return\s+)?)?<\w/.test(afterArrow) ||
        /^\s*\(?\s*<\w/.test(afterArrow);

      if (!hasJSX) {
        continue;
      }

      // Check if the first JSX element has a key prop
      const firstJSXMatch = afterArrow.match(/<\w[^>]*/);
      if (firstJSXMatch) {
        const elementAttributes = firstJSXMatch[0];
        const hasKey = /\bkey\s*[={]/.test(elementAttributes);

        if (!hasKey) {
          matches.push({
            type: 'react-missing-key',
            location: {
              file: filePath,
              line: getLineFromPosition(content, mapMatch.index),
            },
            matchedText: mapMatch[0].trim(),
            metadata: {
              element: firstJSXMatch[0].substring(0, 50),
            },
          });
        }
      }
    }

    return matches;
  },
  suggestionTemplate:
    'Add a unique `key` prop to elements rendered in `.map()`. ' +
    'Use a stable identifier (e.g., item ID), NOT the array index.',
});

/**
 * Detects direct mutation of this.state in React class components.
 *
 * Direct state mutation bypasses React's state management and will not
 * trigger re-renders, leading to stale UI and hard-to-debug issues.
 *
 * Pattern: Matches `this.state.property = value`
 *
 * @severity error - Critical bug: state changes won't trigger re-renders
 *
 * @example Detected patterns:
 * ```tsx
 * this.state.count = 5;           // Detected
 * this.state.items = [...items];  // Detected
 *
 * this.setState({ count: 5 });    // NOT detected (correct approach)
 * ```
 */
export const directStateMutationRule: AntiPatternRule = createRegexRule({
  id: 'react-direct-state-mutation',
  name: 'React Direct State Mutation',
  description:
    'Detects direct mutation of this.state which bypasses React state management',
  severity: 'error',
  category: 'react',
  fileExtensions: ['.tsx', '.jsx', '.ts', '.js'],
  pattern: /this\.state\s*\.\s*\w+\s*=/g,
  suggestionTemplate:
    'Never mutate state directly. Use `this.setState()` for class components ' +
    'or the setter function from `useState()` for functional components.',
});

/**
 * Detects useEffect calls with empty dependency arrays that reference
 * props or state variables, indicating potential stale closure issues.
 *
 * When useEffect has an empty dependency array [] but references props
 * or state, the effect captures initial values and never updates,
 * leading to stale data bugs.
 *
 * Detection logic:
 * 1. Find useEffect( calls
 * 2. Check if dependency array is [] (empty)
 * 3. Check if the effect body references props. or state variables
 * 4. Flag as potential stale closure issue
 *
 * Note: This is an approximation. False positives are possible for
 * intentional mount-only effects. Marked as info severity.
 *
 * @severity info - Potential stale closure, may be intentional
 *
 * @example Detected patterns:
 * ```tsx
 * useEffect(() => {
 *   console.log(props.userId);  // Detected: references props with [] deps
 * }, []);
 * ```
 */
export const useEffectDependenciesRule: AntiPatternRule = createHeuristicRule({
  id: 'react-useeffect-dependencies',
  name: 'React useEffect Dependencies',
  description:
    'Detects useEffect with empty dependency array that references props or state (stale closure risk)',
  severity: 'info',
  category: 'react',
  fileExtensions: ['.tsx', '.jsx', '.ts', '.js'],
  check: (content: string, filePath: string): AntiPatternMatch[] => {
    const matches: AntiPatternMatch[] = [];

    // Find useEffect calls
    const useEffectPattern = /useEffect\s*\(\s*/g;
    let effectMatch: RegExpExecArray | null;

    while ((effectMatch = useEffectPattern.exec(content)) !== null) {
      const startPos = effectMatch.index + effectMatch[0].length;

      // Find the matching closing parenthesis for useEffect(...)
      // We need to find the callback body and the dependency array
      let parenCount = 1;
      let pos = startPos;

      // Find the end of the first argument (callback)
      let callbackEnd = -1;
      let braceCount = 0;
      let inCallback = false;

      for (; pos < content.length && parenCount > 0; pos++) {
        const char = content[pos];
        if (char === '(' || char === '{' || char === '[') {
          if (char === '{') braceCount++;
          if (char === '(') parenCount++;
          if (char === '{' && !inCallback) inCallback = true;
        } else if (char === ')' || char === '}' || char === ']') {
          if (char === '}') {
            braceCount--;
            if (braceCount === 0 && inCallback && callbackEnd === -1) {
              callbackEnd = pos;
            }
          }
          if (char === ')') parenCount--;
        }
      }

      if (callbackEnd === -1) {
        continue;
      }

      // Extract the callback body
      const callbackBody = content.substring(startPos, callbackEnd + 1);

      // Check for empty dependency array after callback
      const afterCallback = content.substring(callbackEnd + 1, pos);
      const hasEmptyDeps = /,\s*\[\s*\]/.test(afterCallback);

      if (!hasEmptyDeps) {
        continue;
      }

      // Check if callback references props or state
      const referencesProps =
        /\bprops\s*\./.test(callbackBody) || /\bprops\s*\[/.test(callbackBody);
      const referencesState =
        /\bstate\s*\./.test(callbackBody) || /\bthis\.state/.test(callbackBody);

      if (referencesProps || referencesState) {
        matches.push({
          type: 'react-useeffect-dependencies',
          location: {
            file: filePath,
            line: getLineFromPosition(content, effectMatch.index),
          },
          matchedText: 'useEffect(..., [])',
          metadata: {
            referencesProps,
            referencesState,
          },
        });
      }
    }

    return matches;
  },
  suggestionTemplate:
    'Review the dependency array for `useEffect`. Include all referenced ' +
    'variables or use `useCallback`/`useMemo` to stabilize dependencies.',
});

/**
 * Detects React component files exceeding 300 lines.
 *
 * Large component files are difficult to understand, test, and maintain.
 * They often indicate that a component handles too many concerns.
 *
 * Detection logic:
 * 1. Check if file contains React component patterns
 * 2. Count total lines
 * 3. Flag if > 300 lines
 *
 * @severity warning - Maintainability issue
 *
 * @example Detected scenarios:
 * ```
 * src/components/Dashboard.tsx  // 450 lines -> warning
 * src/components/Button.tsx     // 80 lines  -> not detected
 * ```
 */
export const largeComponentRule: AntiPatternRule = createHeuristicRule({
  id: 'react-large-component',
  name: 'React Large Component',
  description:
    'Detects React component files exceeding 300 lines indicating too many responsibilities',
  severity: 'warning',
  category: 'react',
  fileExtensions: ['.tsx', '.jsx'],
  check: (content: string, filePath: string): AntiPatternMatch[] => {
    // Check for React component patterns:
    // - Function returning JSX: function Xxx or const Xxx = ... with return <
    // - Class extending Component/PureComponent
    // - React.FC / React.Component
    const hasReactComponent =
      /(?:function\s+[A-Z]|const\s+[A-Z]\w*\s*[:=]|class\s+\w+\s+extends\s+(?:React\.)?(?:Component|PureComponent)|React\.(?:FC|FunctionComponent))/.test(
        content
      );

    if (!hasReactComponent) {
      return [];
    }

    const lineCount = content.split('\n').length;

    if (lineCount > 300) {
      return [
        {
          type: 'react-large-component',
          location: { file: filePath },
          metadata: {
            lineCount,
            threshold: 300,
          },
        },
      ];
    }

    return [];
  },
  suggestionTemplate:
    'Extract sub-components, custom hooks, and utility functions into separate files. ' +
    'Large components are hard to test and maintain.',
});

/**
 * Detects inline arrow functions as JSX props which cause unnecessary
 * re-renders of child components.
 *
 * When an inline function is passed as a prop, it creates a new function
 * reference on every render, causing React.memo and PureComponent
 * optimizations to fail.
 *
 * Pattern: Matches `propName={(...) =>` syntax
 *
 * @severity info - Performance optimization, not always an issue
 *
 * @example Detected patterns:
 * ```tsx
 * <Button onClick={() => handleClick(id)} />       // Detected
 * <Input onChange={(e) => setName(e.target.value)} /> // Detected
 *
 * <Button onClick={handleClick} />                   // NOT detected
 * <Button onClick={useCallback(() => handleClick(id), [id])} /> // NOT detected
 * ```
 */
export const inlineFunctionPropRule: AntiPatternRule = createRegexRule({
  id: 'react-inline-function-prop',
  name: 'React Inline Function Prop',
  description:
    'Detects inline arrow functions as JSX props causing unnecessary re-renders',
  severity: 'info',
  category: 'react',
  fileExtensions: ['.tsx', '.jsx'],
  pattern: /\w+=\{\s*\([^)]*\)\s*=>/g,
  suggestionTemplate:
    'Extract inline functions to named handlers or use `useCallback()` to ' +
    'prevent unnecessary re-renders of child components.',
});

// ============================================
// Exports
// ============================================

/**
 * All React anti-pattern detection rules.
 *
 * Import this array to register all React rules with the RuleRegistry,
 * or import individual rules for selective registration.
 *
 * @example
 * ```typescript
 * import { reactRules, RuleRegistry } from './rules';
 *
 * const registry = new RuleRegistry();
 * reactRules.forEach(rule => registry.registerRule(rule));
 * ```
 */
export const reactRules: AntiPatternRule[] = [
  missingKeyRule,
  directStateMutationRule,
  useEffectDependenciesRule,
  largeComponentRule,
  inlineFunctionPropRule,
];

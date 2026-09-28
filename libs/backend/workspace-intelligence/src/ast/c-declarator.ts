/**
 * The name a C/C++ declarator declares (Batch 31 r1 R31-02).
 *
 * A C declarator nests without bound: `int (*needle())(int)` is a function
 * declarator inside a pointer inside parentheses inside a function
 * declarator, and `int a::b::C<T>::needle()` nests scopes. A tree-sitter
 * query cannot recurse, so a fixed alternation of shapes silently missed
 * valid definitions; this walks the chain instead. Captures named
 * `…declarator` are converted to their full depth for it
 * (`tree-sitter-parser.service.ts`, `captureDepth`).
 *
 * The walk follows the declarator child of each wrapper down to the declared
 * name. The parameters are those of the innermost function declarator: the
 * one directly around the name, so `int (*needle())(int)` is `needle()`
 * (returning a function pointer), not `needle(int)`.
 */
import type { GenericAstNode } from './ast.types';

/** Nodes that are the declared name itself. */
const NAME_NODES: ReadonlySet<string> = new Set([
  'identifier',
  'field_identifier',
  'type_identifier',
  'destructor_name',
  'operator_name',
  'operator_cast',
]);

/** Wrappers whose declarator is their first declarator-like named child. */
const WRAPPER_NODES: ReadonlySet<string> = new Set([
  'pointer_declarator',
  'reference_declarator',
  'parenthesized_declarator',
  'array_declarator',
  'attributed_declarator',
  'init_declarator',
  'function_declarator',
  'template_function',
  'template_method',
]);

export interface DeclaredName {
  /** The declared name; a qualified one's last segment (`a::B::run` → `run`). */
  readonly name: string;
  /** The innermost function declarator's parameter list, when there is one. */
  readonly parameters?: GenericAstNode;
}

/** Whether a child can continue the declarator chain (not a qualifier or attribute). */
function continuesChain(node: GenericAstNode): boolean {
  return (
    node.isNamed &&
    (NAME_NODES.has(node.type) ||
      WRAPPER_NODES.has(node.type) ||
      node.type === 'qualified_identifier')
  );
}

/**
 * The declared name of a C/C++ declarator, or `undefined` when the chain
 * ends in something that names nothing (a macro-generated or abstract
 * declarator, or a node cut off by the capture depth).
 */
export function cDeclaratorName(
  declarator: GenericAstNode,
): DeclaredName | undefined {
  let current: GenericAstNode | undefined = declarator;
  let parameters: GenericAstNode | undefined;
  while (current !== undefined) {
    if (NAME_NODES.has(current.type)) {
      return { name: current.text, parameters };
    }
    if (current.type === 'qualified_identifier') {
      // `scope :: name`: the name is the last named child.
      current = [...current.children].reverse().find(continuesChain);
      continue;
    }
    if (!WRAPPER_NODES.has(current.type)) return undefined;
    if (current.type === 'function_declarator') {
      parameters =
        current.children.find((child) => child.type === 'parameter_list') ??
        parameters;
    }
    current = current.children.find(continuesChain);
  }
  return undefined;
}

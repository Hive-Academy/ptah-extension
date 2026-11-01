/** Make feature probes see the same EvalError as CSP without a violation event. */
export function disableDynamicFunction(target: Window & { Function: FunctionConstructor } = window as Window & { Function: FunctionConstructor }): void {
  const original = target.Function;
  const denied = () => { throw new EvalError('Dynamic code generation is disabled'); };
  Object.defineProperty(target, 'Function', {
    configurable: true,
    writable: true,
    value: new Proxy(original, { construct: denied, apply: denied }),
  });
}

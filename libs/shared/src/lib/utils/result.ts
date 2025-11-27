/**
 * A type-safe Result class that represents either a success value or an error.
 * Implements the Result pattern for explicit error handling.
 *
 * @template T The type of the success value
 * @template E The type of the error value (defaults to Error)
 */
export class Result<T, E extends Error = Error> {
  private readonly _value?: T;
  private readonly _error?: E;
  private readonly _isSuccess: boolean;

  private constructor(isSuccess: boolean, value?: T, error?: E) {
    this._isSuccess = isSuccess;
    this._value = value;
    this._error = error;
    Object.freeze(this);
  }

  /**
   * Creates a successful Result containing the given value.
   * @param value The success value
   */
  public static ok<T>(value: T): Result<T, never> {
    return new Result<T, never>(true, value);
  }

  /**
   * Creates a failed Result containing the given error.
   * @param error The error value
   */
  public static err<E extends Error>(error: E): Result<never, E> {
    return new Result<never, E>(false, undefined, error);
  }

  /**
   * Maps the success value to a new value using the given function.
   * @param fn The mapping function
   */
  public map<U>(fn: (value: T) => U): Result<U, E> {
    return this.isOk() ? Result.ok(fn(this._value!)) : Result.err(this._error!);
  }

  /**
   * Maps the success value to a new Result using the given function.
   * @param fn The mapping function that returns a Result
   */
  public flatMap<U>(fn: (value: T) => Result<U, E>): Result<U, E> {
    return this.isOk() ? fn(this._value!) : Result.err(this._error!);
  }

  /**
   * Returns the success value or the given default value if this is an error.
   * @param defaultValue The default value to return if this is an error
   */
  public unwrapOr(defaultValue: T): T {
    return this.isOk() ? this._value! : defaultValue;
  }

  /**
   * Returns the success value or throws the error if this is an error.
   * @throws {E} The error if this is an error Result
   */
  public unwrap(): T {
    if (!this.isOk()) {
      if (this._error instanceof Error) {
        throw this._error;
      }
      // This should never happen due to type constraint E extends Error
      throw new Error('Unknown error');
    }
    return this._value!;
  }

  /**
   * Returns true if this is a success Result.
   */
  public isOk(): boolean {
    return this._isSuccess;
  }

  /**
   * Returns true if this is an error Result.
   */
  public isErr(): boolean {
    return !this._isSuccess;
  }

  /**
   * Returns the error if this is an error Result, or undefined if this is a success Result.
   */
  public get error(): E | undefined {
    return this._error;
  }

  /**
   * Returns the success value if this is a success Result, or undefined if this is an error Result.
   */
  public get value(): T | undefined {
    return this._value;
  }
}

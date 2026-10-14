/**
 * An initial value or a getter for it. A function is always taken as the getter, so state that
 * holds a function must pass `() => fn`.
 */
export type Initial<T> = T | (() => T);

export const resolveInitial = <T>(initial: Initial<T>): T =>
  // The narrowing leaves `(() => T) | (T & Function)`; by the contract above both are getters.
  typeof initial === 'function' ? (initial as () => T)() : initial;

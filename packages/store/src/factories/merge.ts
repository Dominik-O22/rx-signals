// Merging of id records for `SignalsFactory.compose`. The rule is rc23's, so `ids.conflicts1.x`
// call sites keep working; only the runtime conflict test changed from truthiness to key presence.

type ConflictKeys<T1 extends object, T2 extends object> = {
  [K in keyof T1]: K extends keyof T2 ? K : never;
}[keyof T1];

type NoConflictKeys<T1 extends object, T2 extends object> = {
  [K in keyof T1]: K extends keyof T2 ? never : K;
}[keyof T1];

type Conflicts<T1 extends object, T2 extends object> = { [K in ConflictKeys<T1, T2>]: T1[K] };

type NoConflicts<T1 extends object, T2 extends object> = {
  [K in NoConflictKeys<Omit<T1, 'conflicts1' | 'conflicts2'>, T2>]: T1[K];
};

type Nested<T extends object> = ('conflicts1' extends keyof T
  ? { conflicts1: T['conflicts1'] }
  : unknown) &
  ('conflicts2' extends keyof T ? { conflicts2: T['conflicts2'] } : unknown);

/**
 * `T1 & T2` when no key is shared. Otherwise shared keys move under `conflicts1` (from T1) and
 * `conflicts2` (from T2), and the other keys stay at the top.
 */
export type Merged<T1 extends object, T2 extends object> = [ConflictKeys<T1, T2>] extends [never]
  ? T1 & T2
  : NoConflicts<T1, T2> &
      NoConflicts<T2, T1> & {
        conflicts1: Conflicts<T1, T2> & Nested<T1>;
        conflicts2: Conflicts<T2, T1> & Nested<T2>;
      };

const nestedKeys = ['conflicts1', 'conflicts2'] as const;

export const merge = <T1 extends object, T2 extends object>(t1: T1, t2: T2): Merged<T1, T2> => {
  const top: Record<string, unknown> = {};
  const c1: Record<string, unknown> = {};
  const c2: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(t1)) {
    if (nestedKeys.some(nested => nested === key)) continue;
    if (Object.hasOwn(t2, key)) c1[key] = value;
    else top[key] = value;
  }
  for (const [key, value] of Object.entries(t2)) {
    if (nestedKeys.some(nested => nested === key)) continue;
    if (Object.hasOwn(t1, key)) c2[key] = value;
    else top[key] = value;
  }
  const nestedIn = (t: object) => nestedKeys.filter(key => Object.hasOwn(t, key));
  const bothNest = nestedKeys.some(key => Object.hasOwn(t1, key) && Object.hasOwn(t2, key));
  if (Object.keys(c1).length > 0 || bothNest) {
    for (const key of nestedIn(t1)) c1[key] = Reflect.get(t1, key);
    for (const key of nestedIn(t2)) c2[key] = Reflect.get(t2, key);
    top.conflicts1 = c1;
    top.conflicts2 = c2;
  } else {
    for (const key of nestedIn(t1)) top[key] = Reflect.get(t1, key);
    for (const key of nestedIn(t2)) top[key] = Reflect.get(t2, key);
  }
  // The loops above perform the partition that `Merged` describes; TS cannot follow Object.entries.
  return top as Merged<T1, T2>;
};

export type KeysOfValueType<T extends object, VT> = {
  [K in keyof T]: T[K] extends VT ? K : never;
}[keyof T];

export type WithValueType<T extends object, VT> = { [K in KeysOfValueType<T, VT>]: T[K] };

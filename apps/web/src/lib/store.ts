import { useSyncExternalStore } from 'react';

/**
 * A ~40-line external store, used instead of a state library.
 *
 * The attempt player needs three things a reducer in React state cannot give
 * it cheaply: the sync engine must read and write state from a timer callback
 * outside the React tree, a palette of 180 cells must not re-render when an
 * unrelated field changes, and the store must outlive a suspended render.
 * `useSyncExternalStore` is the supported primitive for exactly that.
 */

export interface Store<T> {
  getState(): T;
  /** Replaces state with the result of `updater`. Returning the same reference is a no-op. */
  update(updater: (previous: T) => T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    update(updater) {
      const next = updater(state);
      if (Object.is(next, state)) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Subscribe to a slice.
 *
 * `isEqual` defaults to `Object.is`, so a selector returning a fresh object
 * every call will re-render on every store write. Selectors here return
 * primitives or stable references for that reason.
 */
export function useStore<T, S>(
  store: Store<T>,
  selector: (state: T) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S {
  let cached: { value: S } | null = null;

  const getSnapshot = (): S => {
    const next = selector(store.getState());
    if (cached !== null && isEqual(cached.value, next)) return cached.value;
    cached = { value: next };
    return next;
  };

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** Shallow array equality, for selectors that project a list of ids. */
export function shallowArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

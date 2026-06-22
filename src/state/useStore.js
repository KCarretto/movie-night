// React binding for the runtime store. Components call useStore() to re-render
// whenever the controller / data loaders call emit().
import { useSyncExternalStore } from 'react';
import { subscribe, getSnapshot, runtime } from '../lib/runtime.js';

// Subscribe to the whole runtime; returns the live (mutable) runtime object.
// We rely on the monotonically-increasing snapshot token to trigger renders,
// then read fields straight off `runtime`.
export function useStore() {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return runtime;
}

import { useCallback, useEffect, useState } from 'react';
import { ApiError, asApiError } from '../api/errors.js';

export type Resource<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: ApiError };

/**
 * Loads one thing and reports loading, ready or error. A request that is superseded (a new page, a screen change) is aborted
 * and its result ignored, so a slow answer can never overwrite a newer one.
 */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): { state: Resource<T>; reload: () => void } {
  const [state, setState] = useState<Resource<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', error: asApiError(error) });
      },
    );
    return () => controller.abort();
    // `load` is recreated every render on purpose: the caller lists exactly what the request depends on in `deps`.
  }, [...deps, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}

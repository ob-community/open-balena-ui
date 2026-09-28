import * as React from 'react';
import { useDataProvider, useNotify } from 'react-admin';
import type { AdminAccessContext, OpenBalenaDataProvider } from '../dataProvider/openBalenaDataProvider';

interface AdminAccessContextState {
  context?: AdminAccessContext;
  error?: Error;
  isPending: boolean;
}

export const useAdminAccessContext = (): AdminAccessContextState => {
  const dataProvider = useDataProvider<OpenBalenaDataProvider>();
  const notify = useNotify();
  const [state, setState] = React.useState<AdminAccessContextState>({ isPending: true });

  React.useEffect(() => {
    const controller = new AbortController();
    dataProvider
      .getAdminAccessContext({ signal: controller.signal })
      .then((context) => setState({ context, isPending: false }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const normalizedError = error instanceof Error ? error : new Error('Unable to determine administrator access.');
        setState({ error: normalizedError, isPending: false });
        notify(normalizedError.message, { type: 'error' });
      });
    return () => controller.abort();
  }, [dataProvider, notify]);

  return state;
};

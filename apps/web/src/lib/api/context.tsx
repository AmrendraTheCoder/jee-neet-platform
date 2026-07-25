import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { ApiClient } from './client.js';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider(props: {
  readonly client: ApiClient;
  readonly children: ReactNode;
}): JSX.Element {
  return <ApiContext.Provider value={props.client}>{props.children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (client === null) throw new Error('useApi used outside ApiProvider');
  return client;
}

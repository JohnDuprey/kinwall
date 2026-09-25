import type { Provider } from './types.ts';
import { provider as icsProvider } from './ics.ts';
import { provider as googleProvider } from './google.ts';
import { provider as microsoftProvider } from './microsoft.ts';
import { provider as caldavProvider } from './caldav.ts';

export type ProviderKind = 'ics' | 'google' | 'microsoft' | 'caldav';

const providers: Record<ProviderKind, Provider> = {
  ics: icsProvider,
  google: googleProvider,
  microsoft: microsoftProvider,
  caldav: caldavProvider,
};

export function getProvider(kind: ProviderKind): Provider {
  return providers[kind];
}

export { icsProvider, googleProvider, microsoftProvider, caldavProvider };

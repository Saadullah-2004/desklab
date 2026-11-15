import 'server-only';
import type {LimitedRoute} from './rate-limit';
import {isProductionRuntime} from './server-config';

export type ApiRoute = LimitedRoute | 'health';

export function recordApiRequest(
  route: ApiRoute,
  status: number,
  startedAt: number,
): void {
  if (!isProductionRuntime()) return;
  // This schema accepts no request, error, body, URL, identifier or free text.
  // Hosting platform access logs have their own separate retention settings.
  const event = {
    event: 'api_request',
    route,
    status,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
  try {
    console.info(JSON.stringify(event));
  } catch {
    // Diagnostics must not turn a completed request into an application failure.
  }
}

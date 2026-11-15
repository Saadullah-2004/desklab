import 'server-only';

export type ServerEnvironment = Readonly<Record<string, string | undefined>>;

export function isProductionRuntime(
  environment: ServerEnvironment = process.env,
): boolean {
  return environment.NODE_ENV === 'production' || Boolean(environment.VERCEL);
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(origin).hostname,
    );
  } catch {
    return false;
  }
}

export function appOrigin(
  environment: ServerEnvironment = process.env,
): string | null {
  const value = environment.APP_ORIGIN?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      (environment.VERCEL && isLoopbackOrigin(url.origin)) ||
      (isProductionRuntime(environment) &&
        url.protocol !== 'https:' &&
        !isLoopbackOrigin(url.origin))
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function originConfigurationReady(
  environment: ServerEnvironment = process.env,
): boolean {
  return environment.APP_ORIGIN
    ? appOrigin(environment) !== null
    : !isProductionRuntime(environment);
}

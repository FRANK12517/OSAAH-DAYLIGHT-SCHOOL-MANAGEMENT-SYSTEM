const LOCAL_ROUTE_ORIGIN = 'https://osaah.invalid';

function asLocalRoute(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  try {
    const url = new URL(value, LOCAL_ROUTE_ORIGIN);
    if (url.origin !== LOCAL_ROUTE_ORIGIN) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * Resolve the initial route without duplicating role-to-dashboard policy in the client.
 * A fresh school login may use the server's canonical redirect; session restoration
 * keeps the route the user explicitly opened before refresh.
 */
export function resolveDashboardRoute({ portal, currentPath = '/', redirectTo = '/', freshLogin = false } = {}) {
  const currentRoute = asLocalRoute(currentPath) ?? '/';
  if (portal !== 'school' || !freshLogin) return currentRoute;
  return asLocalRoute(redirectTo) ?? currentRoute;
}

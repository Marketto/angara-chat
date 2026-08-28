interface NotificationWindowClient {
  url: string;
  focus(): Promise<unknown>;
  navigate(url: string): Promise<NotificationWindowClient | null | undefined>;
}

interface NotificationClientCollection {
  matchAll(options: { type: 'window'; includeUncontrolled: true }): Promise<NotificationWindowClient[]>;
  openWindow(url: string): Promise<unknown>;
}

function sameOriginTarget(targetUrl: string, scopeUrl: string) {
  const scope = new URL(scopeUrl);
  try {
    const target = new URL(targetUrl, scope);
    return target.origin === scope.origin ? target.href : scope.href;
  } catch {
    return scope.href;
  }
}

/** Reuse the installed app window so one notification click cannot create competing clients. */
export async function openNotificationTarget(
  clients: NotificationClientCollection,
  targetUrl: string,
  scopeUrl: string,
) {
  const target = sameOriginTarget(targetUrl, scopeUrl);
  const scopeOrigin = new URL(scopeUrl).origin;
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = windows.find((client) => {
    try { return new URL(client.url).origin === scopeOrigin; }
    catch { return false; }
  });
  if (existing) {
    const navigated = await existing.navigate(target);
    await (navigated ?? existing).focus();
    return;
  }
  await clients.openWindow(target);
}

export function isSupportedEnterpriseOAuthTarget(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const hostname = url.hostname.toLowerCase();

    return (
      url.protocol === "https:" &&
      (hostname === "stackenterprise.co" || hostname.endsWith(".stackenterprise.co"))
    );
  } catch {
    return false;
  }
}

export function normalizeOAuthBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.host}`;
}

export function isSupportedEnterpriseOAuthTarget(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const hostname = url.hostname.toLowerCase();
    const authority = readHttpsAuthority(baseUrl);

    return (
      authority !== null &&
      authority.length > 0 &&
      url.protocol === "https:" &&
      isDnsDomain(hostname) &&
      !isStackOverflowTeamsHostname(hostname) &&
      !authority.includes("@") &&
      !hasExplicitPort(authority) &&
      url.username === "" &&
      url.password === "" &&
      url.port === ""
    );
  } catch {
    return false;
  }
}

export function normalizeOAuthBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.host}`;
}

function readHttpsAuthority(value: string): string | null {
  return value.trim().match(/^https:\/\/([^/?#]*)/i)?.[1] ?? null;
}

function hasExplicitPort(authority: string): boolean {
  if (authority.startsWith("[")) {
    const closingBracket = authority.indexOf("]");
    return closingBracket >= 0 && authority.slice(closingBracket + 1).startsWith(":");
  }
  return authority.includes(":");
}

function isStackOverflowTeamsHostname(hostname: string): boolean {
  const canonicalHostname = hostname.replace(/\.$/, "");
  return (
    canonicalHostname === "stackoverflowteams.com" ||
    canonicalHostname.endsWith(".stackoverflowteams.com")
  );
}

function isDnsDomain(hostname: string): boolean {
  const canonicalHostname = hostname.replace(/\.$/, "");
  if (
    !canonicalHostname.includes(".") ||
    canonicalHostname.endsWith(".localhost") ||
    canonicalHostname.startsWith("[") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(canonicalHostname)
  ) {
    return false;
  }

  return canonicalHostname.length <= 253 && canonicalHostname.split(".").every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
  );
}

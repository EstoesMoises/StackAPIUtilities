import { StackApiV2Client } from "../api/stackApiV2";
import { StackApiV3Client } from "../api/stackApiV3";
import type { FetchLike, ThrottleNotice } from "../api/httpClient";
import { normalizeInstanceUrl } from "../credentials/credentialRules";
import type { SessionCredentials } from "../domain/types";
import type { LiveCollectorClients } from "./liveCollectors";

export interface LiveCollectorClientOptions {
  fetchFn?: FetchLike;
  onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;
}

export function createLiveCollectorClients(
  credentials: SessionCredentials,
  options: LiveCollectorClientOptions = {},
): LiveCollectorClients {
  const instance = normalizeInstanceUrl(credentials.baseUrl);
  const token = credentials.instanceType === "basic-business" ? credentials.pat ?? "" : credentials.accessToken ?? "";

  return {
    v2: new StackApiV2Client({
      apiV2Url: instance.apiV2Url,
      teamSlug: instance.teamSlug,
      headers: createV2Headers(credentials),
      fetchFn: options.fetchFn,
      onThrottle: options.onThrottle,
    }),
    v3: new StackApiV3Client({
      apiV3Url: instance.apiV3Url,
      token,
      fetchFn: options.fetchFn,
      onThrottle: options.onThrottle,
    }),
  };
}

function createV2Headers(credentials: SessionCredentials): HeadersInit {
  const headers: Record<string, string> = {};

  if (credentials.apiKey) {
    headers["X-API-Key"] = credentials.apiKey;
  }

  if (credentials.instanceType === "basic-business" && credentials.pat) {
    headers["X-API-Access-Token"] = credentials.pat;
    headers.Authorization = `Bearer ${credentials.pat}`;
  }

  return headers;
}

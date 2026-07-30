import { type FetchLike, type ThrottleNotice, readJsonResponse } from "./httpClient";

type WaitFn = (seconds: number) => Promise<void>;
type NowFn = () => number;

interface StackApiV3ClientOptions {
  apiV3Url: string;
  token: string;
  fetchFn?: FetchLike;
  onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;
  waitFn?: WaitFn;
  nowFn?: NowFn;
}

interface StackApiV3Page<T> {
  items?: T[];
  totalPages?: number;
}

export interface StackApiV3UserSummary {
  id: number;
  email?: string | null;
  name?: string;
}

export interface StackApiV3UserGroup {
  id: number;
  name: string;
  description?: string | null;
  users?: StackApiV3UserSummary[];
}

interface CreateUserGroupInput {
  name: string;
  description?: string;
  userIds: number[];
}

interface PagingOptions {
  maxPages?: number;
}

export interface StackApiPagedResult<T> {
  items: T[];
  pageCount: number;
  reachedMaxPages: boolean;
  hasMore: boolean;
}

const API_V3_USER_AGENT =
  "StackAPIUtilities/0.1 (+https://github.com/EstoesMoises/StackAPIUtilities)";
const BURST_LOW_WATERMARK = 5;
const TOKEN_BUCKET_LOW_WATERMARK = 30;
const MAX_GET_RETRIES = 3;
const FALLBACK_RETRY_SECONDS = 2;

const waitSeconds: WaitFn = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1_000));

function shouldFetchNextPage({
  page,
  totalPages,
  maxPages,
  lastPageItemCount,
}: {
  page: number;
  totalPages: number | null;
  maxPages: number;
  lastPageItemCount: number;
}) {
  if (page > maxPages) return false;

  return totalPages === null ? lastPageItemCount > 0 : page <= totalPages;
}

export class StackApiV3Client {
  private readonly apiV3Url: string;
  private readonly token: string;
  private readonly fetchFn: FetchLike;
  private readonly onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;
  private readonly waitFn: WaitFn;
  private readonly nowFn: NowFn;

  constructor(options: StackApiV3ClientOptions) {
    this.apiV3Url = options.apiV3Url.replace(/\/+$/, "");
    this.token = options.token;
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    this.onThrottle = options.onThrottle;
    this.waitFn = options.waitFn ?? waitSeconds;
    this.nowFn = options.nowFn ?? (() => Date.now());
  }

  async getPagedItems<T = unknown>(
    path: string,
    query: Record<string, string> = {},
    options: PagingOptions = {},
  ): Promise<T[]> {
    return (await this.getPagedResult<T>(path, query, options)).items;
  }

  async getPagedResult<T = unknown>(
    path: string,
    query: Record<string, string> = {},
    options: PagingOptions = {},
  ): Promise<StackApiPagedResult<T>> {
    const items: T[] = [];
    let page = 1;
    let totalPages: number | null = null;
    let pageCount = 0;
    let lastPageItemCount = 0;
    const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;

    do {
      const url = this.buildUrl(path, { ...query, page: String(page) });
      const response = await this.readResponse(url);

      const body = await readJsonResponse<StackApiV3Page<T>>(response, "Stack API v3");
      const pageItems = body.items ?? [];
      items.push(...pageItems);
      lastPageItemCount = pageItems.length;
      totalPages = typeof body.totalPages === "number" && Number.isFinite(body.totalPages)
        ? body.totalPages
        : totalPages;
      pageCount += 1;
      page += 1;
    } while (shouldFetchNextPage({ page, totalPages, maxPages, lastPageItemCount }));

    const hasMore = totalPages === null
      ? pageCount >= maxPages && lastPageItemCount > 0
      : pageCount < totalPages;

    return {
      items,
      pageCount,
      reachedMaxPages: pageCount >= maxPages && hasMore,
      hasMore,
    };
  }

  async getUserByEmail(email: string): Promise<StackApiV3UserSummary | null> {
    const response = await this.readResponse(
      this.buildUrl(`/users/by-email/${encodeURIComponent(email)}`, {}),
    );

    if (response.status === 404) {
      return null;
    }

    return readJsonResponse<StackApiV3UserSummary>(response, "Stack API v3");
  }

  async getUserGroups(): Promise<StackApiV3UserGroup[]> {
    return this.getPagedItems<StackApiV3UserGroup>("/user-groups", { pageSize: "100" });
  }

  async createUserGroup(input: CreateUserGroupInput): Promise<StackApiV3UserGroup> {
    return this.writeJson<StackApiV3UserGroup>("/user-groups", "POST", input);
  }

  async addUserGroupMembers(userGroupId: number, userIds: number[]): Promise<StackApiV3UserGroup> {
    return this.writeJson<StackApiV3UserGroup>(`/user-groups/${userGroupId}/members`, "POST", userIds);
  }

  async removeUserGroupMember(userGroupId: number, userId: number): Promise<void> {
    const response = await this.fetchFn(this.buildUrl(`/user-groups/${userGroupId}/members/${userId}`, {}), {
      method: "DELETE",
      headers: this.createJsonHeaders(),
    });

    if (!response.ok) {
      await readJsonResponse<unknown>(response, "Stack API v3");
    }
  }

  private buildUrl(path: string, query: Record<string, string>): URL {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.apiV3Url}${normalizedPath}`);

    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    return url;
  }

  private async writeJson<T>(path: string, method: "POST" | "PUT", body: unknown): Promise<T> {
    const response = await this.fetchFn(this.buildUrl(path, {}), {
      method,
      headers: this.createJsonHeaders(),
      body: JSON.stringify(body),
    });

    return readJsonResponse<T>(response, "Stack API v3");
  }

  private createJsonHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      "User-Agent": API_V3_USER_AGENT,
    };
  }

  private async readResponse(url: URL): Promise<Response> {
    for (let retryCount = 0; ; retryCount += 1) {
      const response = await this.fetchFn(url, {
        headers: this.createJsonHeaders(),
      });

      if (response.status !== 429) {
        await this.notifyThrottle(response.headers);
        return response;
      }

      if (retryCount >= MAX_GET_RETRIES) {
        return response;
      }

      await this.waitFn(getRetryDelaySeconds(response.headers, this.nowFn()));
    }
  }

  private async notifyThrottle(headers: Headers): Promise<void> {
    if (!this.onThrottle) {
      return;
    }

    const burstCallsLeft = parseIntegerHeader(headers, "x-burst-throttle-calls-left");
    const burstSecondsUntilFull = parseIntegerHeader(headers, "x-burst-throttle-seconds-until-full");

    if (
      burstCallsLeft !== null &&
      burstSecondsUntilFull !== null &&
      burstCallsLeft < BURST_LOW_WATERMARK &&
      burstSecondsUntilFull > 0
    ) {
      await this.onThrottle({ kind: "burst", seconds: burstSecondsUntilFull, remaining: burstCallsLeft });
    }

    const callsLeft = parseIntegerHeader(headers, "x-token-bucket-calls-left");
    const secondsUntilRefill = parseIntegerHeader(headers, "x-token-bucket-seconds-until-next-refill");

    if (
      callsLeft !== null &&
      secondsUntilRefill !== null &&
      callsLeft <= TOKEN_BUCKET_LOW_WATERMARK &&
      secondsUntilRefill > 0
    ) {
      await this.onThrottle({ kind: "token-bucket", seconds: secondsUntilRefill, remaining: callsLeft });
    }
  }
}

function getRetryDelaySeconds(headers: Headers, nowMs: number): number {
  const durations = [
    parseRetryAfter(headers.get("Retry-After"), nowMs),
    parseNonNegativeInteger(headers.get("x-burst-throttle-seconds-until-full")),
    parseNonNegativeInteger(headers.get("x-token-bucket-seconds-until-next-refill")),
  ].filter((duration): duration is number => duration !== null);

  return durations.length > 0 ? Math.max(...durations) : FALLBACK_RETRY_SECONDS;
}

function parseRetryAfter(value: string | null, nowMs: number): number | null {
  const seconds = parseNonNegativeInteger(value);
  if (seconds !== null) {
    return seconds;
  }

  if (value === null) {
    return null;
  }

  const retryDateMs = Date.parse(value);
  if (Number.isNaN(retryDateMs)) {
    return null;
  }

  return Math.max(0, Math.ceil((retryDateMs - nowMs) / 1_000));
}

function parseIntegerHeader(headers: Headers, name: string): number | null {
  return parseNonNegativeInteger(headers.get(name));
}

function parseNonNegativeInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

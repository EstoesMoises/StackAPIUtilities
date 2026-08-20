import { type FetchLike, type ThrottleNotice, readJsonResponse } from "./httpClient";
import {
  assertSafePaginationPage,
  DEFAULT_PAGINATION_SAFETY_LIMIT,
} from "./paginationSafety";

type WaitFn = (seconds: number) => Promise<void>;

interface StackApiV2ClientOptions {
  apiV2Url: string;
  teamSlug: string | null;
  headers?: HeadersInit;
  fetchFn?: FetchLike;
  onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;
  waitFn?: WaitFn;
  paginationSafetyLimit?: number;
}

interface StackApiV2Page<T> {
  items: T[];
  has_more: boolean;
  backoff?: number;
  quota_remaining?: number;
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

const waitSeconds: WaitFn = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1_000));

export class StackApiV2Client {
  private readonly apiV2Url: string;
  private readonly teamSlug: string | null;
  private readonly headers: HeadersInit;
  private readonly fetchFn: FetchLike;
  private readonly onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;
  private readonly waitFn: WaitFn;
  private readonly paginationSafetyLimit: number;
  private pendingBackoffSeconds: number | null = null;
  private activeBackoffWait: Promise<void> | null = null;

  constructor(options: StackApiV2ClientOptions) {
    this.apiV2Url = options.apiV2Url.replace(/\/+$/, "");
    this.teamSlug = options.teamSlug;
    this.headers = options.headers ?? {};
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    this.onThrottle = options.onThrottle;
    this.waitFn = options.waitFn ?? waitSeconds;
    this.paginationSafetyLimit = options.paginationSafetyLimit ?? DEFAULT_PAGINATION_SAFETY_LIMIT;
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
    let hasMore = true;
    let pageCount = 0;
    const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;

    while (hasMore && page <= maxPages) {
      assertSafePaginationPage("Stack API v2.3", path, page, this.paginationSafetyLimit);
      const url = this.buildUrl(path, { ...query, page: String(page) });
      await this.waitForPendingBackoff();
      const response = await this.fetchFn(url, { headers: this.headers });
      const body = validatePaginationEnvelope<T>(
        await readJsonResponse<unknown>(response, "Stack API v2.3"),
        path,
        page,
      );

      items.push(...body.items);
      await this.recordBackoff(body);

      hasMore = body.has_more;
      pageCount += 1;
      page += 1;
    }

    return {
      items,
      pageCount,
      reachedMaxPages: hasMore && page > maxPages,
      hasMore,
    };
  }

  private buildUrl(path: string, query: Record<string, string>): URL {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.apiV2Url}${normalizedPath}`);

    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    if (this.teamSlug) {
      url.searchParams.set("team", this.teamSlug);
    }

    return url;
  }

  private async recordBackoff<T>(body: StackApiV2Page<T>): Promise<void> {
    if (typeof body.backoff !== "number") {
      return;
    }

    this.pendingBackoffSeconds = Math.max(this.pendingBackoffSeconds ?? 0, body.backoff);

    if (this.onThrottle) {
      await this.onThrottle({ kind: "backoff", seconds: body.backoff, remaining: body.quota_remaining });
    }
  }

  private async waitForPendingBackoff(): Promise<void> {
    if (this.activeBackoffWait === null && this.pendingBackoffSeconds !== null) {
      const seconds = this.pendingBackoffSeconds;
      this.pendingBackoffSeconds = null;
      this.activeBackoffWait = Promise.resolve().then(() => this.waitFn(seconds));
    }

    const wait = this.activeBackoffWait;
    if (wait === null) {
      return;
    }

    try {
      await wait;
    } finally {
      if (this.activeBackoffWait === wait) {
        this.activeBackoffWait = null;
      }
    }
  }
}

function validatePaginationEnvelope<T>(
  value: unknown,
  path: string,
  page: number,
): StackApiV2Page<T> {
  if (
    !isRecord(value) ||
    !hasOwn(value, "items") ||
    !Array.isArray(value.items) ||
    !hasOwn(value, "has_more") ||
    typeof value.has_more !== "boolean"
  ) {
    throw invalidPaginationEnvelope(path, page);
  }

  const backoff = readOptionalNonNegativeSafeInteger(value, "backoff", path, page);
  const quotaRemaining = readOptionalNonNegativeSafeInteger(value, "quota_remaining", path, page);

  return {
    items: value.items as T[],
    has_more: value.has_more,
    backoff,
    quota_remaining: quotaRemaining,
  };
}

function readOptionalNonNegativeSafeInteger(
  value: Record<string, unknown>,
  key: "backoff" | "quota_remaining",
  path: string,
  page: number,
): number | undefined {
  if (!hasOwn(value, key)) {
    return undefined;
  }

  const fieldValue = value[key];
  if (typeof fieldValue !== "number" || !Number.isSafeInteger(fieldValue) || fieldValue < 0) {
    throw invalidPaginationEnvelope(path, page);
  }

  return fieldValue;
}

function invalidPaginationEnvelope(path: string, page: number): Error {
  return new Error(
    `Stack API v2.3 returned an invalid pagination envelope for ${path} page ${page}. No complete result was produced.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

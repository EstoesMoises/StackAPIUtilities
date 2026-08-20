import { type FetchLike, type ThrottleNotice, readJsonResponse } from "./httpClient";
import {
  assertSafePaginationPage,
  DEFAULT_PAGINATION_SAFETY_LIMIT,
} from "./paginationSafety";

interface StackApiV2ClientOptions {
  apiV2Url: string;
  teamSlug: string | null;
  headers?: HeadersInit;
  fetchFn?: FetchLike;
  onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;
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

export class StackApiV2Client {
  private readonly apiV2Url: string;
  private readonly teamSlug: string | null;
  private readonly headers: HeadersInit;
  private readonly fetchFn: FetchLike;
  private readonly onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;
  private readonly paginationSafetyLimit: number;

  constructor(options: StackApiV2ClientOptions) {
    this.apiV2Url = options.apiV2Url.replace(/\/+$/, "");
    this.teamSlug = options.teamSlug;
    this.headers = options.headers ?? {};
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    this.onThrottle = options.onThrottle;
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
      const response = await this.fetchFn(url, { headers: this.headers });
      const body = validatePaginationEnvelope<T>(
        await readJsonResponse<unknown>(response, "Stack API v2.3"),
        path,
        page,
      );

      items.push(...body.items);
      await this.notifyBackoff(body);

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

  private async notifyBackoff<T>(body: StackApiV2Page<T>): Promise<void> {
    if (!this.onThrottle || typeof body.backoff !== "number") {
      return;
    }

    await this.onThrottle({ kind: "backoff", seconds: body.backoff, remaining: body.quota_remaining });
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

  return value as unknown as StackApiV2Page<T>;
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

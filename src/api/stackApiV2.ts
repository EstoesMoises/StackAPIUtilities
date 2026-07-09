import { type FetchLike, type ThrottleNotice, readJsonResponse } from "./httpClient";

interface StackApiV2ClientOptions {
  apiV2Url: string;
  teamSlug: string | null;
  headers?: HeadersInit;
  fetchFn?: FetchLike;
  onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;
}

interface StackApiV2Page<T> {
  items?: T[];
  has_more?: boolean;
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

  constructor(options: StackApiV2ClientOptions) {
    this.apiV2Url = options.apiV2Url.replace(/\/+$/, "");
    this.teamSlug = options.teamSlug;
    this.headers = options.headers ?? {};
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    this.onThrottle = options.onThrottle;
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
      const url = this.buildUrl(path, { ...query, page: String(page) });
      const response = await this.fetchFn(url, { headers: this.headers });
      const body = await readJsonResponse<StackApiV2Page<T>>(response, "Stack API v2.3");

      items.push(...(body.items ?? []));
      await this.notifyBackoff(body);

      hasMore = body.has_more === true;
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

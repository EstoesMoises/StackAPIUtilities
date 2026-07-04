import { type FetchLike, type ThrottleNotice, readJsonResponse } from "./httpClient";

interface StackApiV3ClientOptions {
  apiV3Url: string;
  token: string;
  fetchFn?: FetchLike;
  onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;
}

interface StackApiV3Page<T> {
  items?: T[];
  totalPages?: number;
}

const TOKEN_BUCKET_LOW_WATERMARK = 30;

export class StackApiV3Client {
  private readonly apiV3Url: string;
  private readonly token: string;
  private readonly fetchFn: FetchLike;
  private readonly onThrottle?: (notice: ThrottleNotice) => void | Promise<void>;

  constructor(options: StackApiV3ClientOptions) {
    this.apiV3Url = options.apiV3Url.replace(/\/+$/, "");
    this.token = options.token;
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    this.onThrottle = options.onThrottle;
  }

  async getPagedItems<T = unknown>(path: string, query: Record<string, string> = {}): Promise<T[]> {
    const items: T[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const url = this.buildUrl(path, { ...query, page: String(page) });
      const response = await this.fetchFn(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
      });

      const body = await readJsonResponse<StackApiV3Page<T>>(response, "Stack API v3");
      items.push(...(body.items ?? []));
      totalPages = body.totalPages ?? totalPages;
      await this.notifyThrottle(response.headers);

      page += 1;
    } while (page <= totalPages);

    return items;
  }

  private buildUrl(path: string, query: Record<string, string>): URL {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.apiV3Url}${normalizedPath}`);

    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    return url;
  }

  private async notifyThrottle(headers: Headers): Promise<void> {
    if (!this.onThrottle) {
      return;
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

function parseIntegerHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

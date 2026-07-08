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
    let totalPages = 1;
    let pageCount = 0;
    const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;

    do {
      const url = this.buildUrl(path, { ...query, page: String(page) });
      const response = await this.fetchFn(url, {
        headers: this.createJsonHeaders(),
      });

      const body = await readJsonResponse<StackApiV3Page<T>>(response, "Stack API v3");
      items.push(...(body.items ?? []));
      totalPages = body.totalPages ?? totalPages;
      await this.notifyThrottle(response.headers);

      pageCount += 1;
      page += 1;
    } while (page <= totalPages && page <= maxPages);

    return {
      items,
      pageCount,
      reachedMaxPages: pageCount >= maxPages && pageCount < totalPages,
      hasMore: pageCount < totalPages,
    };
  }

  async getUserByEmail(email: string): Promise<StackApiV3UserSummary | null> {
    const response = await this.fetchFn(this.buildUrl(`/users/by-email/${encodeURIComponent(email)}`, {}), {
      headers: this.createJsonHeaders(),
    });

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
    };
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

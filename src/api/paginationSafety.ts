export const DEFAULT_PAGINATION_SAFETY_LIMIT = 10_000;

export class PaginationSafetyError extends Error {
  constructor(apiName: string, path: string, limit: number) {
    super(
      `${apiName} pagination for ${path} exceeded the internal safety limit of ${limit.toLocaleString("en-US")} pages. No complete result was produced.`,
    );
    this.name = "PaginationSafetyError";
  }
}

export function assertSafePaginationPage(
  apiName: string,
  path: string,
  page: number,
  limit: number,
): void {
  if (page <= limit) {
    return;
  }

  throw new PaginationSafetyError(apiName, path, limit);
}

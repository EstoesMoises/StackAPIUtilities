export type FetchLike = typeof fetch;

export interface ThrottleNotice {
  kind: "backoff" | "burst" | "token-bucket";
  seconds: number;
  remaining?: number;
}

export class StackApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
    public readonly responseText: string,
  ) {
    super(message);
  }
}

export async function readJsonResponse<T>(response: Response, apiName: string): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new StackApiError(
      formatStackApiErrorMessage(apiName, response.status, text),
      response.status,
      response.url,
      text,
    );
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    const parseError = new Error(`${apiName} returned invalid JSON from ${response.url || "unknown URL"}.`);
    (parseError as Error & { cause?: unknown }).cause = error;
    throw parseError;
  }
}

function formatStackApiErrorMessage(apiName: string, status: number, responseText: string): string {
  const baseMessage = `${apiName} request failed with ${status}`;

  try {
    const body = JSON.parse(responseText) as { error_name?: unknown; error_message?: unknown };
    const errorName = typeof body.error_name === "string" ? body.error_name.trim() : "";
    const errorMessage = typeof body.error_message === "string" ? body.error_message.trim() : "";

    if (errorName && errorMessage) return `${baseMessage}: ${errorName} - ${errorMessage}`;
    if (errorMessage) return `${baseMessage}: ${errorMessage}`;
    if (errorName) return `${baseMessage}: ${errorName}`;
  } catch {
    // Non-JSON API errors keep the concise status-only message.
  }

  return baseMessage;
}

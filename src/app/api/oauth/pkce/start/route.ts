import { NextRequest, NextResponse } from "next/server";
import { handleOAuthPkceStartRequest } from "../../../../../server/oauthPkceApi";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  const result = await handleOAuthPkceStartRequest(payload, {
    origin: new URL(request.url).origin,
    publicOrigin:
      process.env.STACK_API_UTILITIES_PUBLIC_ORIGIN ??
      process.env.NEXT_PUBLIC_STACK_API_UTILITIES_PUBLIC_ORIGIN,
  });
  const responseBody = await result.response.json();
  const response = NextResponse.json(responseBody, {
    status: result.response.status,
    headers: result.response.headers,
  });

  if (result.cookie) {
    response.cookies.set(result.cookie.name, result.cookie.value, result.cookie);
  }

  return response;
}

import { NextRequest, NextResponse } from "next/server";
import { handleOAuthPkcePublicConfigRequest } from "../../../../../server/oauthPkceApi";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = handleOAuthPkcePublicConfigRequest({
    origin: new URL(request.url).origin,
    publicOrigin:
      process.env.STACK_API_UTILITIES_PUBLIC_ORIGIN ??
      process.env.NEXT_PUBLIC_STACK_API_UTILITIES_PUBLIC_ORIGIN,
    redirectUri: process.env.STACK_API_UTILITIES_OAUTH_REDIRECT_URI,
  });
  const responseBody = await result.response.json();

  return NextResponse.json(responseBody, {
    status: result.response.status,
    headers: result.response.headers,
  });
}

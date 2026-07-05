import { NextRequest, NextResponse } from "next/server";
import {
  OAUTH_PKCE_COOKIE_NAME,
  OAUTH_PKCE_COOKIE_PATH,
  handleOAuthPkceCallbackRequest,
} from "../../../../../server/oauthPkceApi";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = await handleOAuthPkceCallbackRequest(
    new URL(request.url),
    request.cookies.get(OAUTH_PKCE_COOKIE_NAME)?.value,
    {
      publicOrigin:
        process.env.STACK_API_UTILITIES_PUBLIC_ORIGIN ??
        process.env.NEXT_PUBLIC_STACK_API_UTILITIES_PUBLIC_ORIGIN,
    },
  );
  const html = await result.response.text();
  const response = new NextResponse(html, {
    status: result.response.status,
    headers: result.response.headers,
  });

  if (result.clearCookie) {
    response.cookies.set(OAUTH_PKCE_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "lax",
      path: OAUTH_PKCE_COOKIE_PATH,
      maxAge: 0,
    });
  }

  return response;
}

import { handleReportRunRequest } from "../../../../server/reportRunApi";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  return handleReportRunRequest(payload);
}

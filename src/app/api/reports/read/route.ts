import { handleReportReadHttpRequest } from "../../../../server/reportReadApi";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleReportReadHttpRequest(request);
}

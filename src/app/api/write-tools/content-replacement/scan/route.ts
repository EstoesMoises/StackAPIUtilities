import { handleContentReplacementScanRequest } from "../../../../../server/contentReplacementScanApi";
import { readBoundedJsonRequest } from "../../../../../server/enterpriseWriteRequest";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const parsed = await readBoundedJsonRequest(request);
  return parsed.ok ? handleContentReplacementScanRequest(parsed.value) : parsed.response;
}

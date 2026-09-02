import { handleContentReplacementApplyRequest } from "../../../../../server/contentReplacementApplyApi";
import { readBoundedJsonRequest } from "../../../../../server/enterpriseWriteRequest";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const parsed = await readBoundedJsonRequest(request);
  return parsed.ok ? handleContentReplacementApplyRequest(parsed.value) : parsed.response;
}

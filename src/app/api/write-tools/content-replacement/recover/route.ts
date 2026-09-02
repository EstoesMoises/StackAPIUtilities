import { handleContentReplacementRecoveryRequest } from "../../../../../server/contentReplacementRecoveryApi";
import { readBoundedJsonRequest } from "../../../../../server/enterpriseWriteRequest";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const parsed = await readBoundedJsonRequest(request);
  return parsed.ok ? handleContentReplacementRecoveryRequest(parsed.value) : parsed.response;
}

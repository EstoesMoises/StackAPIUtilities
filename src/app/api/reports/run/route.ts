export const runtime = "nodejs";

/** Old open tabs must reload instead of starting an unbounded collection request. */
export async function POST(): Promise<Response> {
  return Response.json({ ok: false, error: "Live reports now use resumable collection. Refresh the app and run the report again." }, {
    status: 410, headers: { "Cache-Control": "no-store" },
  });
}

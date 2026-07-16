export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ status: "ok", mode: process.env.MOCK_MODE === "0" ? "real" : "mock" }, { headers: { "Cache-Control": "no-store" } });
}

import { bad, deviceState, validDeviceId } from "@/lib/device";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("deviceId");
  if (!validDeviceId(id)) return bad("invalid deviceId");
  return Response.json(await deviceState(id));
}

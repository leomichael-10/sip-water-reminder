import { bad, validDeviceId } from "@/lib/device";
import { sendToDevice } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Sends one notification right away so you can check that push works. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validDeviceId(body.deviceId)) return bad("invalid deviceId");
  const sent = await sendToDevice(body.deviceId, {
    title: "It works 💧",
    body: "This is how your water reminders will look.",
    url: "/",
  });
  if (!sent) return bad("No active subscription. Turn reminders on again.", 404);
  return Response.json({ sent });
}

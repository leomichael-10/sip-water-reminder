import { prisma } from "@/lib/db";
import { bad, deviceState, getOrCreateDevice, validDeviceId } from "@/lib/device";

export const dynamic = "force-dynamic";

/** Body: { deviceId, subscription: PushSubscriptionJSON } */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const sub = body?.subscription;
  if (!body || !validDeviceId(body.deviceId)) return bad("invalid deviceId");
  if (
    typeof sub?.endpoint !== "string" ||
    !sub.endpoint.startsWith("https://") ||
    typeof sub?.keys?.p256dh !== "string" ||
    typeof sub?.keys?.auth !== "string"
  ) {
    return bad("invalid subscription");
  }
  await getOrCreateDevice(body.deviceId);
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: { deviceId: body.deviceId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    create: {
      deviceId: body.deviceId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    },
  });
  return Response.json(await deviceState(body.deviceId));
}

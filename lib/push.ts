import webpush from "web-push";
import { prisma } from "./db";

let configured = false;
function configure() {
  if (configured) return;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT; // e.g. mailto:you@example.com
  if (!pub || !priv || !subject) throw new Error("VAPID env vars are missing");
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

/** Sends to every subscription of a device. Removes subscriptions Apple says are gone. */
export async function sendToDevice(deviceId: string, payload: PushPayload) {
  configure();
  const subs = await prisma.pushSubscription.findMany({ where: { deviceId } });
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 30, urgency: "normal" }
        );
        sent++;
      } catch (err: unknown) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        } else {
          console.error("push failed", code, err);
        }
      }
    })
  );
  return sent;
}

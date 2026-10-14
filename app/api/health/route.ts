import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Reports reachability/config as booleans only — never leaks secret values. */
export async function GET() {
  const dbOk = await prisma.$queryRaw`SELECT 1`.then(
    () => true,
    () => false
  );
  const vapidConfigured = Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT
  );
  const cronSecretSet = Boolean(process.env.CRON_SECRET);

  return Response.json({ dbOk, vapidConfigured, cronSecretSet });
}

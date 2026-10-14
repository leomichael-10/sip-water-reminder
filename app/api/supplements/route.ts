import { prisma } from "@/lib/db";
import { bad, deviceState, getOrCreateDevice, validDeviceId } from "@/lib/device";

export const dynamic = "force-dynamic";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Body: { deviceId, name, timeOfDay } — adds a new vitamin/supplement. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validDeviceId(body.deviceId)) return bad("invalid deviceId");
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  if (!name) return bad("name is required");
  if (typeof body.timeOfDay !== "string" || !TIME_RE.test(body.timeOfDay)) return bad("timeOfDay must be HH:MM");

  await getOrCreateDevice(body.deviceId);
  await prisma.supplement.create({ data: { deviceId: body.deviceId, name, timeOfDay: body.timeOfDay } });
  return Response.json(await deviceState(body.deviceId));
}

/** Body: { deviceId, id, name?, timeOfDay?, enabled? } — edits an existing vitamin/supplement. */
export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validDeviceId(body.deviceId) || typeof body.id !== "string") return bad("invalid deviceId or id");

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 100);
  if (typeof body.timeOfDay === "string" && TIME_RE.test(body.timeOfDay)) data.timeOfDay = body.timeOfDay;
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;

  await prisma.supplement.updateMany({ where: { id: body.id, deviceId: body.deviceId }, data });
  return Response.json(await deviceState(body.deviceId));
}

/** Body: { deviceId, id } — removes a vitamin/supplement (and its log history, via cascade). */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validDeviceId(body.deviceId) || typeof body.id !== "string") return bad("invalid deviceId or id");

  await prisma.supplement.deleteMany({ where: { id: body.id, deviceId: body.deviceId } });
  return Response.json(await deviceState(body.deviceId));
}

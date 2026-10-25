import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api/auth";
import { errorResponse } from "@/lib/api/respond";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    const sent = await sendPushToUsers([auth.userId], { title: "SILO Gestion Église", body: "Les notifications sont activées sur cet appareil.", url: "/dashboard", tag: "silo-push-test" });
    return NextResponse.json({ sent }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

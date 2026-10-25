import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/api/auth";
import { errorResponse, validationResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  // PushSubscription.toJSON() includes this standard field in Safari, iOS and Chromium.
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(20).max(256), auth: z.string().min(8).max(128) }),
}).strict();

function allowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    const allowed = host === "fcm.googleapis.com" || host === "web.push.apple.com" || host.endsWith(".push.apple.com") || host.endsWith(".mozilla.org") || host.endsWith(".mozilla.com") || host.endsWith(".notify.windows.com") || host.endsWith(".wns.windows.com");
    return url.protocol === "https:" && !url.username && !url.password && allowed;
  } catch { return false; }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    const parsed = subscriptionSchema.safeParse(await request.json());
    if (!parsed.success) return validationResponse("Abonnement de notification invalide.");
    if (!allowedPushEndpoint(parsed.data.endpoint)) return validationResponse("Fournisseur de notifications non pris en charge.");
    const supabase = getSupabaseAdmin();
    const { data: existing, error: lookupError } = await supabase.from("push_subscriptions").select("user_id").eq("endpoint", parsed.data.endpoint).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing && existing.user_id !== auth.userId) return validationResponse("Cet appareil est déjà associé à un autre compte.", 409);
    const { error } = await supabase.from("push_subscriptions").upsert({
      endpoint: parsed.data.endpoint, user_id: auth.userId,
      p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, updated_at: new Date().toISOString(),
    }, { onConflict: "endpoint" });
    if (error) throw error;
    return NextResponse.json({ subscribed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    const parsed = z.object({ endpoint: z.string().url().max(2048) }).safeParse(await request.json());
    if (!parsed.success) return validationResponse("Abonnement de notification invalide.");
    const { error } = await getSupabaseAdmin().from("push_subscriptions").delete().eq("endpoint", parsed.data.endpoint).eq("user_id", auth.userId);
    if (error) throw error;
    return NextResponse.json({ subscribed: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

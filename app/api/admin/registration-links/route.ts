import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/api/auth";
import { errorResponse, validationResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const createLinkSchema = z.object({
  type: z.enum(["general", "individual"]),
  expiresInHours: z.number().int().min(1).max(8760).nullable().optional(),
  usageLimit: z.number().int().min(1).max(10000).nullable().optional(),
  memberId: z.string().uuid().optional(),
  label: z.string().trim().max(120).optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, "links.manage");
    const { data, error } = await getSupabaseAdmin().from("registration_links")
      .select("id, link_type, status, created_at, expires_at, usage_count, usage_limit, label")
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json({ links: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePermission(request, "links.manage");
    const parsed = createLinkSchema.safeParse(await request.json());
    if (!parsed.success) return validationResponse(parsed.error.issues[0]?.message ?? "Paramètres de lien invalides.");
    if (parsed.data.type === "individual" && !parsed.data.memberId) return validationResponse("Choisissez la personne concernée.");
    const supabase = getSupabaseAdmin();
    if (parsed.data.memberId) {
      const { data: member, error } = await supabase.from("members").select("id").eq("id", parsed.data.memberId).maybeSingle();
      if (error) throw error;
      if (!member) return validationResponse("Cette fiche n’existe pas.", 404);
    }
    const rawToken = randomBytes(16).toString("base64url");
    const expiresAt = parsed.data.expiresInHours
      ? new Date(Date.now() + parsed.data.expiresInHours * 3600000).toISOString()
      : null;
    const usageLimit = parsed.data.usageLimit ?? (parsed.data.type === "individual" ? 1 : null);
    const { data: link, error } = await supabase.from("registration_links").insert({
      token_hash: createHash("sha256").update(rawToken).digest("hex"),
      link_type: parsed.data.type,
      created_by: auth.userId,
      expires_at: expiresAt,
      usage_limit: usageLimit,
      individual_member_id: parsed.data.memberId ?? null,
      label: parsed.data.label || null,
    }).select("id, link_type, status, created_at, expires_at, usage_count, usage_limit, label").single();
    if (error) throw error;
    const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    const vercelProductionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const vercelHost = process.env.VERCEL_URL;
    const appUrl = publicAppUrl?.startsWith("https://")
      ? publicAppUrl
      : vercelProductionHost ? `https://${vercelProductionHost}`
        : vercelHost ? `https://${vercelHost}` : new URL(request.url).origin;
    const url = `${appUrl.replace(/\/$/, "")}/i/${rawToken}`;
    await supabase.from("audit_logs").insert({
      user_id: auth.userId, action: "registration_link.created", object_type: "registration_link", object_id: link.id,
    });
    return NextResponse.json({ link, url }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

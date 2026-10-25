import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/api/respond";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!/^[A-Za-z0-9_-]{35,60}$/.test(token)) return NextResponse.json({ error: "Ce lien d’inscription est invalide." }, { status: 404 });
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const supabase = getSupabaseAdmin();
    const { data: link, error } = await supabase.from("registration_links")
      .select("id, status, expires_at, usage_count, usage_limit, link_type")
      .eq("token_hash", tokenHash).maybeSingle();
    if (error) throw error;
    const expired = link?.expires_at && new Date(link.expires_at).getTime() <= Date.now();
    const exhausted = link?.usage_limit !== null && link?.usage_limit !== undefined && link.usage_count >= link.usage_limit;
    if (!link || link.status !== "active" || expired || exhausted) {
      return NextResponse.json({ error: "Ce lien d’inscription n’est plus actif. Contactez l’administration." }, { status: 404 });
    }
    const { data: departments, error: departmentError } = await supabase.from("departments")
      .select("id, name").eq("status", "active").order("name");
    if (departmentError) throw departmentError;
    return NextResponse.json({ departments: departments ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/api/auth";
import { errorResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, "audit.read");
    const supabase = getSupabaseAdmin();
    const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 100));
    const { data: rows, error } = await supabase.from("audit_logs")
      .select("id,user_id,action,object_type,object_id,result,context,created_at")
      .order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    const userIds = [...new Set((rows ?? []).map((row) => row.user_id).filter(Boolean))] as string[];
    const { data: profiles, error: profilesError } = userIds.length
      ? await supabase.from("profiles").select("id,full_name").in("id", userIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const names = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));
    return NextResponse.json({ entries: (rows ?? []).map((row) => ({ ...row, actor_name: row.user_id ? names.get(row.user_id) ?? "Compte désactivé" : "Système" })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

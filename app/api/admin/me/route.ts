import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/api/respond";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    const { data, error } = await getSupabaseAdmin().from("profile_permissions").select("permission_key").eq("profile_id", auth.userId);
    if (error) throw error;
    return NextResponse.json({ ...auth, permissions: (data ?? []).map((item) => item.permission_key) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

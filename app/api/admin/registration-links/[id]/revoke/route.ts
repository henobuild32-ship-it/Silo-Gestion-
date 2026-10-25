import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/api/auth";
import { errorResponse, validationResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "links.manage");
    const { id } = await params;
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("registration_links").update({ status: "revoked" }).eq("id", id).eq("status", "active")
      .select("id").maybeSingle();
    if (error) throw error;
    if (!data) return validationResponse("Ce lien est déjà désactivé ou introuvable.", 404);
    const { error: auditError } = await supabase.from("audit_logs").insert({ user_id: auth.userId, action: "registration_link.revoked", object_type: "registration_link", object_id: id });
    if (auditError) throw auditError;
    return NextResponse.json({ message: "Lien désactivé." });
  } catch (error) { return errorResponse(error); }
}

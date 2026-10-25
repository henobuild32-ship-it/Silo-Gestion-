import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/api/respond";
import { registrationTokenPattern } from "@/lib/registration-token";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!registrationTokenPattern.test(token)) return NextResponse.json({ error: "Ce lien d’inscription est invalide." }, { status: 404 });
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const supabase = getSupabaseAdmin();
    const { data: editToken, error: editTokenError } = await supabase.from("submission_edit_tokens")
      .select("id, submission_id, expires_at, used_at")
      .eq("token_hash", tokenHash).maybeSingle();
    if (editTokenError) throw editTokenError;
    if (editToken) {
      if (editToken.used_at || new Date(editToken.expires_at).getTime() <= Date.now()) {
        return NextResponse.json({ error: "Ce lien de correction n’est plus actif. Demandez un nouveau lien à l’administration." }, { status: 410 });
      }
      const { data: submission, error: submissionError } = await supabase.from("worker_submissions")
        .select("reference_number, data, status")
        .eq("id", editToken.submission_id).eq("status", "needs_changes").maybeSingle();
      if (submissionError) throw submissionError;
      if (!submission) return NextResponse.json({ error: "Ce lien de correction n’est plus actif. Contactez l’administration." }, { status: 404 });
      const [{ data: departments, error: departmentError }, { data: requested, error: requestedError }] = await Promise.all([
        supabase.from("departments").select("id, name").eq("status", "active").order("name"),
        supabase.from("worker_submission_departments").select("department_id").eq("submission_id", editToken.submission_id),
      ]);
      if (departmentError) throw departmentError;
      if (requestedError) throw requestedError;
      return NextResponse.json({
        mode: "correction",
        reference: submission.reference_number,
        data: submission.data,
        departmentIds: (requested ?? []).map((row) => row.department_id),
        departments: departments ?? [],
      }, { headers: { "Cache-Control": "no-store" } });
    }
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

import { NextRequest, NextResponse } from "next/server";
import { hasProfilePermission, requirePermission } from "@/lib/api/auth";
import { errorResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePermission(request, "submissions.read");
    const supabase = getSupabaseAdmin();
    const canValidate = auth.role === "super_admin" || await hasProfilePermission(auth, "submissions.validate");
    const status = request.nextUrl.searchParams.get("status");
    let query = supabase.from("worker_submissions")
      .select("id, reference_number, data, photo_path, status, date_soumission, date_traitement, motif_rejet, correction_note, member_id")
      .order("date_soumission", { ascending: false }).limit(200);
    if (status === "to_review") query = query.in("status", ["pending", "reviewing"]);
    else if (status && ["pending", "reviewing", "needs_changes", "approved", "rejected"].includes(status)) query = query.eq("status", status);

    if (auth.role === "department_lead") {
      const { data: visible } = await supabase.from("worker_submission_departments").select("submission_id")
        .in("department_id", auth.departmentIds);
      const ids = [...new Set((visible ?? []).map((row) => row.submission_id))];
      if (ids.length === 0) return NextResponse.json({ submissions: [], canValidate }, { headers: { "Cache-Control": "no-store" } });
      query = query.in("id", ids);
    }

    const { data, error } = await query;
    if (error) throw error;
    const rows = data ?? [];
    const submissionIds = rows.map((row) => row.id);
    const [requestedResult, departmentsResult] = await Promise.all([
      submissionIds.length ? supabase.from("worker_submission_departments").select("submission_id, department_id").in("submission_id", submissionIds) : Promise.resolve({ data: [], error: null }),
      supabase.from("departments").select("id, name"),
    ]);
    if (requestedResult.error) throw requestedResult.error;
    if (departmentsResult.error) throw departmentsResult.error;
    const departmentNames = new Map((departmentsResult.data ?? []).map((department) => [department.id, department.name]));
    const departmentsBySubmission = new Map<string, string[]>();
    for (const item of requestedResult.data ?? []) {
      const names = departmentsBySubmission.get(item.submission_id) ?? [];
      const name = departmentNames.get(item.department_id);
      if (name) names.push(name);
      departmentsBySubmission.set(item.submission_id, names);
    }
    const submissions = await Promise.all(rows.map(async (row) => {
      const signed = row.photo_path ? await supabase.storage.from("church-profiles").createSignedUrl(row.photo_path, 300) : null;
      return {
        ...row,
        departments: departmentsBySubmission.get(row.id) ?? [],
        requested_department_ids: (requestedResult.data ?? []).filter((item) => item.submission_id === row.id).map((item) => item.department_id),
        photo_url: signed?.data?.signedUrl ?? null,
      };
    }));
    return NextResponse.json({ submissions, canValidate }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

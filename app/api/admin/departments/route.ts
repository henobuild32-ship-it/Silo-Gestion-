import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasProfilePermission } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/auth";
import { errorResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    const canReadAll = await hasProfilePermission(auth, "departments.read_all");
    if (auth.role !== "super_admin" && !canReadAll && auth.departmentIds.length === 0) throw new ApiError(403, "Aucun département ne vous est attribué.");
    const supabase = getSupabaseAdmin();
    let query = supabase.from("departments").select("id, name, description, status").order("name");
    if (!canReadAll && auth.role !== "super_admin") query = query.in("id", auth.departmentIds);
    const { data: departments, error } = await query;
    if (error) throw error;
    const departmentIds = (departments ?? []).map((item) => item.id);
    const [assignments, submissions, leads] = await Promise.all([
      departmentIds.length ? supabase.from("member_departments").select("department_id, member_id").in("department_id", departmentIds).eq("status", "active") : Promise.resolve({ data: [], error: null }),
      departmentIds.length ? supabase.from("worker_submission_departments").select("department_id, submission_id").in("department_id", departmentIds) : Promise.resolve({ data: [], error: null }),
      departmentIds.length ? supabase.from("profile_departments").select("department_id, profile_id").in("department_id", departmentIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (assignments.error) throw assignments.error;
    if (submissions.error) throw submissions.error;
    if (leads.error) throw leads.error;
    const submissionIds = [...new Set((submissions.data ?? []).map((item) => item.submission_id))];
    const { data: pendingRows, error: pendingError } = submissionIds.length
      ? await supabase.from("worker_submissions").select("id").in("id", submissionIds).in("status", ["pending", "reviewing", "needs_changes"])
      : { data: [], error: null };
    if (pendingError) throw pendingError;
    const pendingSet = new Set((pendingRows ?? []).map((item) => item.id));
    const profileIds = [...new Set((leads.data ?? []).map((item) => item.profile_id))];
    const { data: profiles, error: profileError } = profileIds.length ? await supabase.from("profiles").select("id, full_name").in("id", profileIds) : { data: [], error: null };
    if (profileError) throw profileError;
    const names = new Map((profiles ?? []).map((item) => [item.id, item.full_name]));
    return NextResponse.json({ departments: (departments ?? []).map((department) => ({
      ...department,
      active_workers: new Set((assignments.data ?? []).filter((item) => item.department_id === department.id).map((item) => item.member_id)).size,
      pending_submissions: new Set((submissions.data ?? []).filter((item) => item.department_id === department.id && pendingSet.has(item.submission_id)).map((item) => item.submission_id)).size,
      leaders: (leads.data ?? []).filter((item) => item.department_id === department.id).map((item) => names.get(item.profile_id)).filter(Boolean),
    })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

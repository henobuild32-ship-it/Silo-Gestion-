import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/api/auth";
import { errorResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, "dashboard.read");
    const supabase = getSupabaseAdmin();
    const today = new Date().toISOString();
    const [members, workers, visitors, leaders, pending, reviewing, changes, approved, rejected, activities, attendance, departments, assignments] = await Promise.all([
      supabase.from("members").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("member_categories").select("member_id", { count: "exact", head: true }).eq("category", "worker"),
      supabase.from("member_categories").select("member_id", { count: "exact", head: true }).eq("category", "visitor"),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "department_lead").eq("status", "active"),
      supabase.from("worker_submissions").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("worker_submissions").select("id", { count: "exact", head: true }).eq("status", "reviewing"),
      supabase.from("worker_submissions").select("id", { count: "exact", head: true }).eq("status", "needs_changes"),
      supabase.from("worker_submissions").select("id", { count: "exact", head: true }).eq("status", "approved"),
      supabase.from("worker_submissions").select("id", { count: "exact", head: true }).eq("status", "rejected"),
      supabase.from("activities").select("id", { count: "exact", head: true }).eq("status", "active").gte("date_debut", today),
      supabase.from("attendance").select("statut_presence").gte("event_date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)),
      supabase.from("departments").select("id, name, status").order("name"),
      supabase.from("member_departments").select("department_id").eq("status", "active"),
    ]);
    const results = [members, workers, visitors, leaders, pending, reviewing, changes, approved, rejected, activities, attendance, departments, assignments];
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
    const counts = new Map<string, number>();
    for (const row of assignments.data ?? []) counts.set(row.department_id, (counts.get(row.department_id) ?? 0) + 1);
    const departmentStats = (departments.data ?? []).map((item) => ({ ...item, active_workers: counts.get(item.id) ?? 0 }));
    const present = (attendance.data ?? []).filter((row) => row.statut_presence === "present").length;
    const absent = (attendance.data ?? []).filter((row) => row.statut_presence === "absent").length;
    return NextResponse.json({
      stats: {
        members: members.count ?? 0, workers: workers.count ?? 0, visitors: visitors.count ?? 0,
        leaders: leaders.count ?? 0, pending: pending.count ?? 0, reviewing: reviewing.count ?? 0,
        needsChanges: changes.count ?? 0, approved: approved.count ?? 0, rejected: rejected.count ?? 0,
        upcomingActivities: activities.count ?? 0, presentLast30Days: present, absentLast30Days: absent,
      },
      departments: departmentStats,
      updatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

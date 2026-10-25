import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext, hasProfilePermission, requireAnyPermission, requireDepartmentAccess, requirePermission } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/auth";
import { errorResponse, validationResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const attendanceSchema = z.object({ member_id: z.string().uuid(), department_id: z.string().uuid(), activity_id: z.string().uuid().nullable().optional(), event_date: z.string().date(), statut_presence: z.enum(["present", "absent"]) });

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAnyPermission(request, ["attendance.read_all", "attendance.read_assigned"]);
    const supabase = getSupabaseAdmin();
    const canReadAll = await hasProfilePermission(auth, "attendance.read_all");
    const requestedDepartment = request.nextUrl.searchParams.get("department") ?? "";
    if (requestedDepartment) await requireDepartmentAccess(auth, requestedDepartment);
    let departmentQuery = supabase.from("departments").select("id,name").eq("status", "active").order("name");
    if (requestedDepartment) departmentQuery = departmentQuery.eq("id", requestedDepartment);
    else if (!canReadAll) departmentQuery = departmentQuery.in("id", auth.departmentIds);
    const { data: departments, error: deptError } = await departmentQuery;
    if (deptError) throw deptError;
    const ids = (departments ?? []).map((item) => item.id);
    if (!ids.length) return NextResponse.json({ rows: [], departments: [], members: [], activities: [] });
    const [attendance, assignments, activities] = await Promise.all([
      supabase.from("attendance").select("id, member_id, department_id, activity_id, event_date, statut_presence, date_pointage, recorded_by")
        .in("department_id", ids).order("event_date", { ascending: false }).limit(200),
      supabase.from("member_departments").select("member_id, department_id").in("department_id", ids).eq("status", "active"),
      supabase.from("activities").select("id, titre, department_id, date_debut").in("department_id", ids).eq("status", "active").order("date_debut", { ascending: false }).limit(100),
    ]);
    if (attendance.error) throw attendance.error;
    if (assignments.error) throw assignments.error;
    if (activities.error) throw activities.error;
    const memberIds = [...new Set([...(assignments.data ?? []).map((item) => item.member_id), ...(attendance.data ?? []).map((item) => item.member_id)])];
    const [members, recorders] = await Promise.all([
      memberIds.length ? supabase.from("members").select("id,member_number,nom,postnom,prenom").in("id", memberIds).eq("status", "active").order("nom") : Promise.resolve({ data: [], error: null }),
      attendance.data?.some((item) => item.recorded_by) ? supabase.from("profiles").select("id,full_name").in("id", attendance.data.filter((item) => item.recorded_by).map((item) => item.recorded_by!)) : Promise.resolve({ data: [], error: null }),
    ]);
    if (members.error) throw members.error;
    if (recorders.error) throw recorders.error;
    const names = new Map((departments ?? []).map((item) => [item.id, item.name]));
    const memberNames = new Map((members.data ?? []).map((item) => [item.id, `${item.nom} ${item.postnom} ${item.prenom}`]));
    const recorderNames = new Map((recorders.data ?? []).map((item) => [item.id, item.full_name]));
    return NextResponse.json({
      departments,
      members: members.data ?? [],
      activities: activities.data ?? [],
      rows: (attendance.data ?? []).map((item) => ({ ...item, member_name: memberNames.get(item.member_id), department_name: names.get(item.department_id), recorded_by_name: item.recorded_by ? recorderNames.get(item.recorded_by) : null })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePermission(request, "attendance.write");
    const parsed = attendanceSchema.safeParse(await request.json());
    if (!parsed.success) return validationResponse(parsed.error.issues[0]?.message ?? "Pointage invalide.");
    await requireDepartmentAccess(auth, parsed.data.department_id);
    const { data, error } = await getSupabaseAdmin().rpc("create_attendance_with_audit", { p_actor_id: auth.userId, p_data: parsed.data });
    if (error?.message.includes("ATTENDANCE_ALREADY_EXISTS")) return validationResponse("Un pointage existe déjà pour cette personne et cette activité.", 409);
    if (error?.message.includes("MEMBER_NOT_ASSIGNED")) throw new ApiError(400, "Cette personne n’a pas d’affectation active dans ce département.");
    if (error?.message.includes("ACTIVITY_DEPARTMENT_MISMATCH")) throw new ApiError(400, "Cette activité ne correspond pas au département choisi.");
    if (error) throw error;
    return NextResponse.json({ attendance: data }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

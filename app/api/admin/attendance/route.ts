import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasProfilePermission, requireAnyPermission, requireDepartmentAccess, requirePermission } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/auth";
import { errorResponse, validationResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const attendanceSchema = z.object({
  member_id: z.string().uuid(),
  department_id: z.string().uuid(),
  activity_id: z.string().uuid().nullable().optional(),
  event_name: z.string().trim().min(1).max(120).default("Pointage quotidien"),
  event_date: z.string().date(),
  statut_presence: z.enum(["present", "absent", "justified"]),
  justification: z.string().trim().max(1000).default(""),
}).superRefine((data, context) => {
  if (data.statut_presence === "justified" && data.justification.length < 2) {
    context.addIssue({ code: "custom", path: ["justification"], message: "Le motif est requis pour une absence justifiée." });
  }
});

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
    const departmentIds = (departments ?? []).map((item) => item.id);
    if (!departmentIds.length) return NextResponse.json({ rows: [], departments: [], members: [] }, { headers: { "Cache-Control": "no-store" } });

    const [attendanceResult, assignmentResult, workersResult] = await Promise.all([
      supabase.from("attendance").select("id,member_id,department_id,activity_id,event_date,event_name,statut_presence,justification,date_pointage,recorded_by")
        .in("department_id", departmentIds).order("event_date", { ascending: false }).order("event_name").limit(500),
      supabase.from("member_departments").select("member_id,department_id").in("department_id", departmentIds).eq("status", "active"),
      supabase.from("member_categories").select("member_id").eq("category", "worker"),
    ]);
    if (attendanceResult.error) throw attendanceResult.error;
    if (assignmentResult.error) throw assignmentResult.error;
    if (workersResult.error) throw workersResult.error;
    const workerIds = new Set((workersResult.data ?? []).map((item) => item.member_id));
    const assignments = assignmentResult.data ?? [];
    const memberIds = [...new Set([...assignments.map((item) => item.member_id), ...(attendanceResult.data ?? []).map((item) => item.member_id)])];
    const recorderIds = [...new Set((attendanceResult.data ?? []).map((item) => item.recorded_by).filter((id): id is string => Boolean(id)))];
    const [membersResult, recordersResult] = await Promise.all([
      memberIds.length ? supabase.from("members").select("id,member_number,nom,postnom,prenom,status").in("id", memberIds).order("nom") : Promise.resolve({ data: [], error: null }),
      recorderIds.length ? supabase.from("profiles").select("id,full_name").in("id", recorderIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (membersResult.error) throw membersResult.error;
    if (recordersResult.error) throw recordersResult.error;

    const departmentNames = new Map((departments ?? []).map((item) => [item.id, item.name]));
    const memberNames = new Map((membersResult.data ?? []).map((item) => [item.id, `${item.member_number} ${item.nom} ${item.postnom} ${item.prenom}`]));
    const recorderNames = new Map((recordersResult.data ?? []).map((item) => [item.id, item.full_name]));
    const workerMembers = (membersResult.data ?? []).filter((item) => item.status === "active" && workerIds.has(item.id));
    const members = workerMembers.map((member) => ({
      ...member,
      departments: assignments.filter((item) => item.member_id === member.id).map((item) => ({ id: item.department_id, name: departmentNames.get(item.department_id) ?? "Département" })),
    }));
    const rows = (attendanceResult.data ?? []).map((item) => ({
      ...item,
      member_name: memberNames.get(item.member_id) ?? "Fiche inactive",
      department_name: departmentNames.get(item.department_id) ?? "Département",
      recorded_by_name: item.recorded_by ? recorderNames.get(item.recorded_by) ?? null : null,
    }));
    return NextResponse.json({ departments, members, rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePermission(request, "attendance.write");
    const body = await request.json();
    const rawRecords = Array.isArray(body) ? body : Array.isArray(body?.records) ? body.records : [body];
    const parsed = z.array(attendanceSchema).min(1).max(1500).safeParse(rawRecords);
    if (!parsed.success) return validationResponse(parsed.error.issues[0]?.message ?? "Pointage invalide.");
    const departmentIds = [...new Set(parsed.data.map((item) => item.department_id))];
    for (const departmentId of departmentIds) await requireDepartmentAccess(auth, departmentId);

    const { data, error } = await getSupabaseAdmin().rpc("create_attendance_batch_with_audit", {
      p_actor_id: auth.userId,
      p_records: parsed.data,
    });
    if (error?.message.includes("ATTENDANCE_ALREADY_EXISTS")) return validationResponse("Un pointage existe déjà pour au moins une personne, à cette date et pour cet événement.", 409);
    if (error?.message.includes("MEMBER_NOT_ASSIGNED")) throw new ApiError(400, "Une personne n’a pas d’affectation active dans le département choisi.");
    if (error?.message.includes("ACTIVITY_DEPARTMENT_MISMATCH")) throw new ApiError(400, "Une activité ne correspond pas au département choisi.");
    if (error?.message.includes("JUSTIFICATION_REQUIRED")) throw new ApiError(400, "Le motif est requis pour chaque absence justifiée.");
    if (error) throw error;
    return NextResponse.json({ attendance: data, count: parsed.data.length }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

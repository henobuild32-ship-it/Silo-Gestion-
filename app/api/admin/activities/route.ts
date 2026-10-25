import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext, hasProfilePermission, requireAnyPermission, requirePermission, requireDepartmentAccess } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/auth";
import { errorResponse, validationResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const activitySchema = z.object({
  titre: z.string().trim().min(2).max(160), description: z.string().max(3000).optional().or(z.literal("")),
  department_id: z.string().uuid().nullable().optional(), type: z.string().trim().min(2).max(80),
  date_debut: z.string().datetime(), date_fin: z.string().datetime().nullable().optional(), lieu: z.string().max(200).optional(),
  observations: z.string().max(2000).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAnyPermission(request, ["activities.read_all", "activities.read_assigned"]);
    const supabase = getSupabaseAdmin();
    const canReadAll = await hasProfilePermission(auth, "activities.read_all");
    const departmentId = request.nextUrl.searchParams.get("department") ?? "";
    if (departmentId) await requireDepartmentAccess(auth, departmentId);
    let query = supabase.from("activities").select("id, titre, description, department_id, type, date_debut, date_fin, lieu, responsable_id, status, created_at")
      .order("date_debut", { ascending: true }).limit(250);
    if (departmentId) query = query.eq("department_id", departmentId);
    else if (!canReadAll) query = query.in("department_id", auth.departmentIds);
    const { data, error } = await query;
    if (error) throw error;
    const departmentIds = [...new Set((data ?? []).map((item) => item.department_id).filter(Boolean))] as string[];
    const [departments, leaders] = await Promise.all([
      departmentIds.length ? supabase.from("departments").select("id,name").in("id", departmentIds) : Promise.resolve({ data: [], error: null }),
      data?.some((item) => item.responsable_id) ? supabase.from("profiles").select("id,full_name").in("id", data.filter((item) => item.responsable_id).map((item) => item.responsable_id!)) : Promise.resolve({ data: [], error: null }),
    ]);
    if (departments.error) throw departments.error;
    if (leaders.error) throw leaders.error;
    const departmentNames = new Map((departments.data ?? []).map((item) => [item.id, item.name]));
    const leaderNames = new Map((leaders.data ?? []).map((item) => [item.id, item.full_name]));
    return NextResponse.json({ activities: (data ?? []).map((item) => ({ ...item, department_name: item.department_id ? departmentNames.get(item.department_id) : "Église entière", responsable: item.responsable_id ? leaderNames.get(item.responsable_id) : null })) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    const parsed = activitySchema.safeParse(await request.json());
    if (!parsed.success) return validationResponse(parsed.error.issues[0]?.message ?? "Informations invalides.");
    const permission = parsed.data.department_id ? "activities.manage_assigned" : "activities.manage";
    if (!await hasProfilePermission(auth, permission) && auth.role !== "super_admin") throw new ApiError(403, "Vous ne pouvez pas gérer ce programme.");
    if (parsed.data.department_id) await requireDepartmentAccess(auth, parsed.data.department_id);
    const { data, error } = await getSupabaseAdmin().rpc("create_activity_with_audit", { p_actor_id: auth.userId, p_data: parsed.data });
    if (error) throw error;
    return NextResponse.json({ activity: data }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

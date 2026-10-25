import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/api/auth";
import { errorResponse, validationResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const permissionKeys = [
  "dashboard.read", "submissions.read", "submissions.validate", "links.manage",
  "members.read_all", "members.read_assigned", "members.create", "members.assign_departments",
  "departments.read_all", "departments.read_assigned", "attendance.read_all", "attendance.read_assigned", "attendance.write",
  "activities.read_all", "activities.read_assigned", "activities.manage", "activities.manage_assigned",
  "finance.read", "finance.write", "audit.read", "users.manage",
] as const;
const accessFields = {
  fullName: z.string().trim().min(2).max(140),
  role: z.enum(["secretariat", "department_lead"]),
  status: z.enum(["active", "inactive", "archived"]).default("active"),
  permissions: z.array(z.enum(permissionKeys)).max(permissionKeys.length),
  departmentIds: z.array(z.string().uuid()).max(13),
};
const createSchema = z.object({
  ...accessFields,
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
});
const updateSchema = z.object({ id: z.string().uuid(), ...accessFields });

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, "users.manage");
    const supabase = getSupabaseAdmin();
    const [{ data: authUsers, error: usersError }, { data: profiles, error: profilesError }, { data: permissions, error: permissionsError }, { data: assignments, error: assignmentsError }, { data: departments, error: departmentsError }] = await Promise.all([
      supabase.auth.admin.listUsers({ page: 1, perPage: 100 }),
      supabase.from("profiles").select("id,full_name,role,status,created_at").order("created_at", { ascending: false }),
      supabase.from("profile_permissions").select("profile_id,permission_key"),
      supabase.from("profile_departments").select("profile_id,department_id"),
      supabase.from("departments").select("id,name").eq("status", "active").order("name"),
    ]);
    if (usersError) throw usersError;
    if (profilesError) throw profilesError;
    if (permissionsError) throw permissionsError;
    if (assignmentsError) throw assignmentsError;
    if (departmentsError) throw departmentsError;
    const emails = new Map((authUsers.users ?? []).map((user) => [user.id, user.email ?? ""]));
    return NextResponse.json({
      users: (profiles ?? []).map((profile) => ({
        ...profile,
        email: emails.get(profile.id) ?? "",
        permissions: (permissions ?? []).filter((item) => item.profile_id === profile.id).map((item) => item.permission_key),
        departmentIds: (assignments ?? []).filter((item) => item.profile_id === profile.id).map((item) => item.department_id),
      })),
      departments: departments ?? [],
      permissionKeys,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requirePermission(request, "users.manage");
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return validationResponse(parsed.error.issues[0]?.message ?? "Informations de compte invalides.");
    if (parsed.data.role === "department_lead" && !parsed.data.departmentIds.length) return validationResponse("Attribuez au moins un département à ce responsable.");
    const supabase = getSupabaseAdmin();
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: { full_name: parsed.data.fullName },
    });
    if (createError || !created.user) return validationResponse(createError?.message ?? "Création du compte impossible.", 400);
    const { error: accessError } = await supabase.rpc("manage_profile_access", {
      p_actor_id: actor.userId,
      p_profile_id: created.user.id,
      p_full_name: parsed.data.fullName,
      p_role: parsed.data.role,
      p_status: parsed.data.status,
      p_permissions: parsed.data.permissions,
      p_department_ids: parsed.data.departmentIds,
    });
    if (accessError) {
      await supabase.auth.admin.deleteUser(created.user.id);
      throw accessError;
    }
    return NextResponse.json({ message: "Compte créé et autorisations enregistrées." }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requirePermission(request, "users.manage");
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) return validationResponse(parsed.error.issues[0]?.message ?? "Informations de compte invalides.");
    if (parsed.data.id === actor.userId) return validationResponse("Pour préserver votre accès, vous ne pouvez pas modifier votre propre compte.", 403);
    if (parsed.data.role === "department_lead" && !parsed.data.departmentIds.length) return validationResponse("Attribuez au moins un département à ce responsable.");
    const supabase = getSupabaseAdmin();
    const { data: target, error: targetError } = await supabase.from("profiles").select("id,role").eq("id", parsed.data.id).maybeSingle();
    if (targetError) throw targetError;
    if (!target) return validationResponse("Compte introuvable.", 404);
    if (target.role === "super_admin") return validationResponse("Le compte de l’administrateur principal ne peut pas être modifié ici.", 403);
    const { error } = await supabase.rpc("manage_profile_access", {
      p_actor_id: actor.userId,
      p_profile_id: parsed.data.id,
      p_full_name: parsed.data.fullName,
      p_role: parsed.data.role,
      p_status: parsed.data.status,
      p_permissions: parsed.data.permissions,
      p_department_ids: parsed.data.departmentIds,
    });
    if (error) throw error;
    return NextResponse.json({ message: "Autorisations du compte mises à jour." });
  } catch (error) { return errorResponse(error); }
}

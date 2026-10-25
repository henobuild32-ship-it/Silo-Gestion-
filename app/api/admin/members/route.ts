import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext, hasProfilePermission, requirePermission, requireDepartmentAccess, requireAnyPermission } from "@/lib/api/auth";
import { errorResponse, validationResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const memberSchema = z.object({
  nom: z.string().trim().min(1).max(100), postnom: z.string().trim().min(1).max(100), prenom: z.string().trim().min(1).max(100),
  sexe: z.enum(["Femme", "Homme", "Autre"]), date_naissance: z.string().optional().or(z.literal("")), etat_civil: z.string().max(50).optional(),
  telephone: z.string().trim().min(7).max(24).regex(/^[+0-9().\s-]+$/), telephone_secondaire: z.string().max(24).optional(),
  adresse: z.string().trim().min(1).max(250), commune: z.string().trim().min(1).max(100), quartier: z.string().max(100).optional(),
  email: z.union([z.string().email().max(254), z.literal(""), z.undefined()]), frequentation_depuis: z.string().max(100).optional(),
  date_debut_service: z.string().optional().or(z.literal("")), fonction: z.string().max(150).optional(), responsable_actuel: z.string().max(150).optional(),
  observations: z.string().max(2000).optional(), categories: z.array(z.enum(["member", "worker", "visitor"])).min(1).max(3),
  departments: z.array(z.string().uuid()).max(13).default([]),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAnyPermission(request, ["members.read_all", "members.read_assigned"]);
    const supabase = getSupabaseAdmin();
    const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
    const departmentId = request.nextUrl.searchParams.get("department") || "";
    const page = Math.max(0, Number(request.nextUrl.searchParams.get("page") ?? 0) || 0);
    const perPage = 50;
    const canReadAll = await hasProfilePermission(auth, "members.read_all");
    if (departmentId) await requireDepartmentAccess(auth, departmentId);
    let visibleDepartmentIds = auth.departmentIds;
    if (canReadAll && !departmentId) visibleDepartmentIds = [];
    else if (departmentId) visibleDepartmentIds = [departmentId];
    let memberIds: string[] | null = null;
    if (!canReadAll || departmentId) {
      if (visibleDepartmentIds.length === 0) return NextResponse.json({ members: [], total: 0 });
      const { data: assignments, error } = await supabase.from("member_departments").select("member_id")
        .in("department_id", visibleDepartmentIds).eq("status", "active");
      if (error) throw error;
      memberIds = [...new Set((assignments ?? []).map((item) => item.member_id))];
      if (!memberIds.length) return NextResponse.json({ members: [], total: 0 });
    }
    const fields = query ? ["nom", "postnom", "prenom", "member_number", "telephone"] : ["nom"];
    const results = await Promise.all(fields.map((field) => {
      let request = supabase.from("members").select("id, member_number, nom, postnom, prenom, sexe, telephone, commune, photo_path, status, created_at", { count: "exact" }).eq("status", "active");
      if (query) request = request.ilike(field, `%${query}%`);
      if (memberIds) request = request.in("id", memberIds);
      return request.order("nom").range(page * perPage, page * perPage + perPage - 1);
    }));
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
    const unique = new Map<string, Record<string, unknown>>();
    results.forEach((result) => (result.data ?? []).forEach((row) => unique.set(row.id, row)));
    const members = [...unique.values()].slice(0, perPage);
    const ids = members.map((member) => member.id as string);
    const [assignmentResult, categoryResult] = await Promise.all([
      ids.length ? supabase.from("member_departments").select("member_id, department_id, fonction, date_affectation").in("member_id", ids).eq("status", "active") : Promise.resolve({ data: [], error: null }),
      ids.length ? supabase.from("member_categories").select("member_id, category").in("member_id", ids) : Promise.resolve({ data: [], error: null }),
    ]);
    if (assignmentResult.error) throw assignmentResult.error;
    if (categoryResult.error) throw categoryResult.error;
    const deptIds = [...new Set((assignmentResult.data ?? []).map((item) => item.department_id))];
    const { data: departmentRows, error: deptError } = deptIds.length ? await supabase.from("departments").select("id, name").in("id", deptIds) : { data: [], error: null };
    if (deptError) throw deptError;
    const deptNames = new Map((departmentRows ?? []).map((department) => [department.id, department.name]));
    const response = await Promise.all(members.map(async (member) => {
      const signed = member.photo_path ? await supabase.storage.from("church-profiles").createSignedUrl(String(member.photo_path), 300) : null;
      return {
        ...member,
        photo_url: signed?.data?.signedUrl ?? null,
        categories: (categoryResult.data ?? []).filter((item) => item.member_id === member.id).map((item) => item.category),
        departments: (assignmentResult.data ?? []).filter((item) => item.member_id === member.id).map((item) => ({ id: item.department_id, name: deptNames.get(item.department_id), fonction: item.fonction, date_affectation: item.date_affectation })),
      };
    }));
    return NextResponse.json({ members: response, total: results.reduce((max, result) => Math.max(max, result.count ?? 0), 0), page });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePermission(request, "members.create");
    const parsed = memberSchema.safeParse(await request.json());
    if (!parsed.success) return validationResponse(parsed.error.issues[0]?.message ?? "Informations invalides.");
    if (parsed.data.categories.includes("worker") && parsed.data.departments.length === 0) return validationResponse("Un ouvrier doit être affecté à au moins un département.");
    const { categories, departments, ...data } = parsed.data;
    const { data: result, error } = await getSupabaseAdmin().rpc("create_member_with_departments", {
      p_actor_id: auth.userId, p_data: data, p_categories: categories, p_department_ids: departments,
    });
    if (error) {
      if (error.message.includes("POSSIBLE_DUPLICATE")) return validationResponse("Un numéro de téléphone identique existe déjà. Vérifiez la fiche avant de créer un doublon.", 409);
      throw error;
    }
    return NextResponse.json({ member: result }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

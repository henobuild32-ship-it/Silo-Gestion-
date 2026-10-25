import { NextRequest, NextResponse } from "next/server";
import { ApiError, hasProfilePermission, requireAnyPermission } from "@/lib/api/auth";
import { errorResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

async function readMember(request: NextRequest, context: RouteContext) {
  const auth = await requireAnyPermission(request, ["members.read_all", "members.read_assigned"]);
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new ApiError(404, "Fiche introuvable.");
  }

  const supabase = getSupabaseAdmin();
  const { data: member, error: memberError } = await supabase.from("members")
    .select("id,member_number,nom,postnom,prenom,sexe,date_naissance,etat_civil,telephone,telephone_secondaire,adresse,commune,quartier,email,photo_path,categories:member_categories(category),frequentation_depuis,date_debut_service,fonction,responsable_actuel,observations,status,validated_by,validated_at,created_at,updated_at")
    .eq("id", id).maybeSingle();
  if (memberError) throw memberError;
  if (!member) throw new ApiError(404, "Fiche introuvable.");

  const [assignmentResult, historyResult, validatorResult] = await Promise.all([
    supabase.from("member_departments").select("id,department_id,fonction,status,date_affectation,validated_at")
      .eq("member_id", id).eq("status", "active").order("date_affectation", { ascending: true }),
    supabase.from("member_department_history").select("department_id,action,fonction,changed_at,details")
      .eq("member_id", id).order("changed_at", { ascending: false }).limit(100),
    member.validated_by ? supabase.from("profiles").select("full_name").eq("id", member.validated_by).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (assignmentResult.error) throw assignmentResult.error;
  if (historyResult.error) throw historyResult.error;
  if (validatorResult.error) throw validatorResult.error;

  const [canReadAll, canReadAllDepartments] = await Promise.all([
    hasProfilePermission(auth, "members.read_all"),
    hasProfilePermission(auth, "departments.read_all"),
  ]);
  const assignmentRows = assignmentResult.data ?? [];
  if (!canReadAll && !canReadAllDepartments && !assignmentRows.some((item) => auth.departmentIds.includes(item.department_id))) {
    throw new ApiError(403, "Cette fiche ne relève pas de votre périmètre.");
  }

  const departmentIds = [...new Set([
    ...assignmentRows.map((item) => item.department_id),
    ...(historyResult.data ?? []).map((item) => item.department_id),
  ])];
  const [{ data: departments, error: departmentError }, photoResult] = await Promise.all([
    departmentIds.length ? supabase.from("departments").select("id,name").in("id", departmentIds) : Promise.resolve({ data: [], error: null }),
    member.photo_path ? supabase.storage.from("church-profiles").createSignedUrl(member.photo_path, 300) : Promise.resolve({ data: null, error: null }),
  ]);
  if (departmentError) throw departmentError;
  const names = new Map((departments ?? []).map((item) => [item.id, item.name]));
  return {
    auth,
    supabase,
    member: { ...member, validated_by_name: validatorResult.data?.full_name ?? null, photo_url: photoResult.data?.signedUrl ?? null },
    departments: assignmentRows.map((item) => ({
      id: item.department_id,
      name: names.get(item.department_id) ?? "Département",
      fonction: item.fonction,
      date_affectation: item.date_affectation,
      validated_at: item.validated_at,
    })),
    history: (historyResult.data ?? []).map((item) => ({
      ...item,
      department_name: names.get(item.department_id) ?? "Département",
    })),
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const result = await readMember(request, context);
    return NextResponse.json({ member: result.member, departments: result.departments, history: result.history }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { auth, supabase, member } = await readMember(request, context);
    const { error } = await supabase.from("audit_logs").insert({
      user_id: auth.userId,
      action: "member.pdf_exported",
      object_type: "member",
      object_id: member.id,
      context: { member_number: member.member_number },
    });
    if (error) throw error;
    return NextResponse.json({ logged: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

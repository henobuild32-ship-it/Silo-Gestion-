import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasProfilePermission, requireAnyPermission, requireDepartmentAccess, requirePermission } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/auth";
import { errorResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const reportJson = (headers: string[], rows: unknown[][]) => JSON.stringify({
  headers,
  rows: rows.map((row) => row.map((value) => value === null || value === undefined ? "" : String(value))),
});

export async function GET(request: NextRequest) {
  try {
    const type = request.nextUrl.searchParams.get("type") ?? "workers";
    const supabase = getSupabaseAdmin();
    let content: string;
    if (["members", "workers"].includes(type)) {
      const auth = await requireAnyPermission(request, ["members.read_all", "members.read_assigned"]);
      const all = await hasProfilePermission(auth, "members.read_all");
      let members = supabase.from("members").select("id,member_number,nom,postnom,prenom,sexe,telephone,telephone_secondaire,email,adresse,commune,quartier,date_naissance,status").order("nom").limit(5000);
      if (!all) {
        const { data: assignments, error } = await supabase.from("member_departments").select("member_id").in("department_id", auth.departmentIds).eq("status", "active");
        if (error) throw error;
        const ids = [...new Set((assignments ?? []).map((item) => item.member_id))];
        if (!ids.length) members = members.in("id", ["00000000-0000-0000-0000-000000000000"]);
        else members = members.in("id", ids);
      }
      if (type === "workers") {
        const { data: categories, error } = await supabase.from("member_categories").select("member_id").eq("category", "worker");
        if (error) throw error;
        const ids = [...new Set((categories ?? []).map((item) => item.member_id))];
        if (!ids.length) members = members.in("id", ["00000000-0000-0000-0000-000000000000"]);
        else members = members.in("id", ids);
      }
      const { data, error } = await members;
      if (error) throw error;
      const ids = (data ?? []).map((item) => item.id);
      const [categories, assignments] = await Promise.all([
        ids.length ? supabase.from("member_categories").select("member_id,category").in("member_id", ids) : Promise.resolve({ data: [], error: null }),
        ids.length ? supabase.from("member_departments").select("member_id,department_id").in("member_id", ids).eq("status", "active") : Promise.resolve({ data: [], error: null }),
      ]);
      if (categories.error) throw categories.error;
      if (assignments.error) throw assignments.error;
      const deptIds = [...new Set((assignments.data ?? []).map((item) => item.department_id))];
      const { data: departments, error: deptError } = deptIds.length ? await supabase.from("departments").select("id,name").in("id", deptIds) : { data: [], error: null };
      if (deptError) throw deptError;
      const names = new Map((departments ?? []).map((item) => [item.id, item.name]));
      content = reportJson(["Identifiant", "Nom", "Postnom", "Prénom", "Sexe", "Téléphone", "Téléphone secondaire", "Courriel", "Adresse", "Commune", "Quartier", "Date de naissance", "Catégories", "Départements", "Statut"], (data ?? []).map((item) => [
        item.member_number, item.nom, item.postnom, item.prenom, item.sexe, item.telephone, item.telephone_secondaire, item.email,
        item.adresse, item.commune, item.quartier, item.date_naissance,
        (categories.data ?? []).filter((category) => category.member_id === item.id).map((category) => category.category).join(", "),
        (assignments.data ?? []).filter((assignment) => assignment.member_id === item.id).map((assignment) => names.get(assignment.department_id)).filter(Boolean).join(", "), item.status,
      ]));
    } else if (type === "attendance") {
      const auth = await requireAnyPermission(request, ["attendance.read_all", "attendance.read_assigned"]);
      const all = await hasProfilePermission(auth, "attendance.read_all");
      const from = request.nextUrl.searchParams.get("date_from") ?? "";
      const to = request.nextUrl.searchParams.get("date_to") ?? "";
      const departmentId = request.nextUrl.searchParams.get("department_id") ?? "";
      const eventName = (request.nextUrl.searchParams.get("event") ?? "").trim().slice(0, 120);
      const status = request.nextUrl.searchParams.get("status") ?? "";
      if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) throw new ApiError(400, "Période invalide.");
      if (from && to && from > to) throw new ApiError(400, "La date de début doit précéder la date de fin.");
      if (status && !["present", "absent", "justified"].includes(status)) throw new ApiError(400, "Statut invalide.");
      if (departmentId) {
        if (!all && !auth.departmentIds.includes(departmentId)) throw new ApiError(403, "Département hors de votre périmètre de présence.");
        await requireDepartmentAccess(auth, departmentId);
      }
      let query = supabase.from("attendance").select("member_id,department_id,event_date,event_name,statut_presence,justification,self_confirmed_at,date_pointage").order("event_date", { ascending: false }).limit(5000);
      if (departmentId) query = query.eq("department_id", departmentId);
      else if (!all) query = query.in("department_id", auth.departmentIds);
      if (from) query = query.gte("event_date", from);
      if (to) query = query.lte("event_date", to);
      if (eventName) query = query.ilike("event_name", `%${eventName.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
      if (status) query = query.eq("statut_presence", status);
      const { data, error } = await query;
      if (error) throw error;
      const memberIds = [...new Set((data ?? []).map((item) => item.member_id))];
      const departmentIds = [...new Set((data ?? []).map((item) => item.department_id))];
      const [members, departments] = await Promise.all([
        memberIds.length ? supabase.from("members").select("id,member_number,nom,postnom,prenom").in("id", memberIds) : Promise.resolve({ data: [], error: null }),
        departmentIds.length ? supabase.from("departments").select("id,name").in("id", departmentIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (members.error) throw members.error;
      if (departments.error) throw departments.error;
      const memberNames = new Map((members.data ?? []).map((item) => [item.id, `${item.member_number} ${item.nom} ${item.postnom} ${item.prenom}`]));
      const deptNames = new Map((departments.data ?? []).map((item) => [item.id, item.name]));
      content = reportJson(["Date", "Événement", "Identifiant et nom", "Département", "Statut", "Justification", "Confirmation en ligne"], (data ?? []).map((item) => [item.event_date, item.event_name, memberNames.get(item.member_id), deptNames.get(item.department_id), item.statut_presence, item.justification, item.self_confirmed_at ? "Confirmé" : "En attente"]));
    } else if (type === "activities") {
      const auth = await requireAnyPermission(request, ["activities.read_all", "activities.read_assigned"]);
      const all = await hasProfilePermission(auth, "activities.read_all");
      let query = supabase.from("activities").select("titre,type,date_debut,date_fin,lieu,department_id,status,description").order("date_debut", { ascending: false }).limit(5000);
      if (!all) query = query.in("department_id", auth.departmentIds);
      const { data, error } = await query;
      if (error) throw error;
      const ids = [...new Set((data ?? []).map((item) => item.department_id).filter(Boolean))] as string[];
      const { data: departments, error: deptError } = ids.length ? await supabase.from("departments").select("id,name").in("id", ids) : { data: [], error: null };
      if (deptError) throw deptError;
      const names = new Map((departments ?? []).map((item) => [item.id, item.name]));
      content = reportJson(["Titre", "Type", "Début", "Fin", "Lieu", "Département", "Description", "Statut"], (data ?? []).map((item) => [item.titre, item.type, item.date_debut, item.date_fin, item.lieu, item.department_id ? names.get(item.department_id) : "Église entière", item.description, item.status]));
    } else if (type === "finance") {
      await requirePermission(request, "finance.read");
      const { data, error } = await supabase.from("financial_transactions").select("operation_date,type_operation,categorie,montant,devise,motif,department_id,status").order("operation_date", { ascending: false }).limit(5000);
      if (error) throw error;
      const ids = [...new Set((data ?? []).map((item) => item.department_id).filter(Boolean))] as string[];
      const { data: departments, error: deptError } = ids.length ? await supabase.from("departments").select("id,name").in("id", ids) : { data: [], error: null };
      if (deptError) throw deptError;
      const names = new Map((departments ?? []).map((item) => [item.id, item.name]));
      content = reportJson(["Date", "Opération", "Catégorie", "Montant", "Devise", "Motif", "Département", "Statut"], (data ?? []).map((item) => [item.operation_date, item.type_operation, item.categorie, item.montant, item.devise, item.motif, item.department_id ? names.get(item.department_id) : "Général", item.status]));
    } else {
      throw new ApiError(400, "Type de rapport inconnu.");
    }
    const auth = await getAuthContext(request);
    const { error: auditError } = await supabase.from("audit_logs").insert({ user_id: auth.userId, action: "report.exported", object_type: "report", object_id: type });
    if (auditError) throw auditError;
    return new NextResponse(content, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

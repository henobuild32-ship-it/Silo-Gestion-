import { createHash, createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, validationResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const tokenPattern = /^[A-Za-z0-9_-]{24}$/;
const confirmSchema = z.object({
  department_id: z.string().uuid(),
  attendance_id: z.string().uuid(),
  member_id: z.string().uuid(),
  phone_suffix: z.string().trim().regex(/^\d{4}$/, "Saisissez les quatre derniers chiffres du téléphone."),
});

type Context = { params: Promise<{ token: string }> };

async function getLink(token: string) {
  if (!tokenPattern.test(token)) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await getSupabaseAdmin().from("attendance_confirmation_links")
    .select("id,token_hash,event_name,event_date,department_ids,expires_at,revoked_at")
    .eq("token_hash", tokenHash).maybeSingle();
  if (error) throw error;
  if (!data || data.revoked_at || new Date(data.expires_at).getTime() <= Date.now()) return null;
  return data;
}

function normalizedName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").trim();
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const { token } = await context.params;
    const link = await getLink(token);
    if (!link) return validationResponse("Ce lien de confirmation est invalide ou expiré.", 410);
    const supabase = getSupabaseAdmin();
    const deptIds = link.department_ids as string[];
    const { data: departments, error: departmentsError } = await supabase.from("departments")
      .select("id,name").in("id", deptIds).eq("status", "active").order("name");
    if (departmentsError) throw departmentsError;
    const departmentId = request.nextUrl.searchParams.get("department_id") ?? "";
    const search = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
    if (!search) return NextResponse.json({
      meeting: { name: link.event_name, date: link.event_date },
      departments: departments ?? [],
      matches: [],
    }, { headers: { "Cache-Control": "no-store" } });
    if (search.length < 2 || !deptIds.includes(departmentId)) {
      return validationResponse("Choisissez un département et saisissez au moins deux lettres.");
    }

    const { data: attendanceRows, error: attendanceError } = await supabase.from("attendance")
      .select("id,member_id,department_id,self_confirmed_at")
      .eq("event_name", link.event_name).eq("event_date", link.event_date)
      .eq("statut_presence", "present").eq("department_id", departmentId).limit(1500);
    if (attendanceError) throw attendanceError;
    const ids = [...new Set((attendanceRows ?? []).map((row) => row.member_id))];
    const { data: members, error: membersError } = ids.length
      ? await supabase.from("members").select("id,nom,postnom,prenom,status").in("id", ids).eq("status", "active")
      : { data: [], error: null };
    if (membersError) throw membersError;
    const query = normalizedName(search);
    const memberMap = new Map((members ?? []).map((member) => [member.id, member]));
    const matches = (attendanceRows ?? []).flatMap((row) => {
      const member = memberMap.get(row.member_id);
      if (!member) return [];
      const fullName = `${member.nom} ${member.postnom} ${member.prenom}`.trim();
      const matchText = normalizedName(fullName);
      return matchText.includes(query) ? [{
        attendance_id: row.id,
        member_id: member.id,
        full_name: fullName,
        confirmed: Boolean(row.self_confirmed_at),
      }] : [];
    }).slice(0, 20);
    return NextResponse.json({ meeting: { name: link.event_name, date: link.event_date }, departments: departments ?? [], matches }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { token } = await context.params;
    const link = await getLink(token);
    if (!link) return validationResponse("Ce lien de confirmation est invalide ou expiré.", 410);
    const parsed = confirmSchema.safeParse(await request.json());
    if (!parsed.success) return validationResponse(parsed.error.issues[0]?.message ?? "Vérifiez les informations saisies.");
    if (!(link.department_ids as string[]).includes(parsed.data.department_id)) {
      return validationResponse("Cette personne ne figure pas dans le département de cette réunion.", 404);
    }

    const supabase = getSupabaseAdmin();
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rateKey = createHmac("sha256", link.token_hash).update(ip).digest("hex");
    const { data: allowed, error: rateError } = await supabase.rpc("consume_public_submission_rate", {
      p_ip_hash: `attendance-confirmation:${link.id}:${rateKey}`,
    });
    if (rateError) throw rateError;
    if (!allowed) return validationResponse("Trop de tentatives. Réessayez dans une minute.", 429);

    const { data: attendance, error: attendanceError } = await supabase.from("attendance")
      .select("id,member_id,self_confirmed_at")
      .eq("id", parsed.data.attendance_id).eq("member_id", parsed.data.member_id)
      .eq("event_name", link.event_name).eq("event_date", link.event_date)
      .eq("department_id", parsed.data.department_id).eq("statut_presence", "present").maybeSingle();
    if (attendanceError) throw attendanceError;
    if (!attendance) return validationResponse("Votre nom ne correspond pas à une présence enregistrée pour cette réunion.", 404);

    const { data: member, error: memberError } = await supabase.from("members")
      .select("id,telephone,status").eq("id", attendance.member_id).eq("status", "active").maybeSingle();
    if (memberError) throw memberError;
    const phoneDigits = (member?.telephone ?? "").replace(/\D/g, "");
    if (phoneDigits.length < 4 || phoneDigits.slice(-4) !== parsed.data.phone_suffix) {
      return validationResponse("La vérification a échoué. Vérifiez le département, le nom et les quatre derniers chiffres du téléphone.", 400);
    }
    if (attendance.self_confirmed_at) {
      return NextResponse.json({ confirmed: true, already_confirmed: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const { data: updated, error: updateError } = await supabase.from("attendance")
      .update({ self_confirmed_at: new Date().toISOString(), self_confirmation_link_id: link.id })
      .eq("id", attendance.id).is("self_confirmed_at", null).select("id").maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return NextResponse.json({ confirmed: true, already_confirmed: true }, { headers: { "Cache-Control": "no-store" } });
    const { error: auditError } = await supabase.from("audit_logs").insert({
      action: "attendance.worker_confirmed",
      object_type: "attendance",
      object_id: attendance.id,
      context: { confirmation_link_id: link.id, department_id: parsed.data.department_id, event_name: link.event_name, event_date: link.event_date },
    });
    if (auditError) console.error("Échec du journal de confirmation de présence", auditError.message);
    return NextResponse.json({ confirmed: true, already_confirmed: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

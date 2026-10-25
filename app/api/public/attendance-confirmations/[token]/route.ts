import { after, NextRequest, NextResponse } from "next/server";
import { createHash, createHmac, randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { errorResponse, validationResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { attendanceOtpConfigured, distanceInMeters, hashAttendanceOtp, sendAttendanceOtp } from "@/lib/attendance-email";

export const runtime = "nodejs";
const tokenPattern = /^[A-Za-z0-9_-]{24}$/;
const sendCodeSchema = z.object({
  action: z.literal("send_code"),
  intent: z.enum(["confirm", "decline"]),
  department_id: z.string().uuid(),
  full_name: z.string().trim().min(3).max(180),
  email: z.string().trim().email().max(254),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy_meters: z.number().positive().max(30).optional(),
}).superRefine((data, context) => {
  if (data.intent === "confirm" && (data.latitude == null || data.longitude == null || data.accuracy_meters == null)) {
    context.addIssue({ code: "custom", path: ["latitude"], message: "Une position GPS précise est obligatoire pour confirmer." });
  }
});
const verifyCodeSchema = z.object({
  action: z.literal("verify_code"),
  intent: z.enum(["confirm", "decline"]),
  challenge_id: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy_meters: z.number().positive().max(30).optional(),
}).superRefine((data, context) => {
  if (data.intent === "confirm" && (data.latitude == null || data.longitude == null || data.accuracy_meters == null)) {
    context.addIssue({ code: "custom", path: ["latitude"], message: "Une position GPS précise est obligatoire pour confirmer." });
  }
});
const actionSchema = z.discriminatedUnion("action", [sendCodeSchema, verifyCodeSchema]);

type Context = { params: Promise<{ token: string }> };

async function getLink(token: string) {
  if (!tokenPattern.test(token)) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await getSupabaseAdmin().from("attendance_confirmation_links")
    .select("id,token_hash,event_name,event_date,department_ids,expires_at,revoked_at,center_latitude,center_longitude,radius_meters")
    .eq("token_hash", tokenHash).maybeSingle();
  if (error) throw error;
  if (!data || data.revoked_at || new Date(data.expires_at).getTime() <= Date.now()) return null;
  return data;
}

function normalizedName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").trim().replace(/\s+/g, " ");
}

async function allowRequest(linkId: string, linkHash: string, request: NextRequest, action: string) {
  const supabase = getSupabaseAdmin();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipHash = createHmac("sha256", linkHash).update(action + ":" + ip).digest("hex");
  const { data, error } = await supabase.rpc("consume_public_submission_rate", {
    p_ip_hash: "meeting-otp:" + linkId + ":" + ipHash,
  });
  if (error) throw error;
  return Boolean(data);
}

function noStore() {
  return { "Cache-Control": "no-store" };
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { token } = await context.params;
    const link = await getLink(token);
    if (!link) return validationResponse("Ce lien de confirmation est invalide ou expiré.", 410);
    if (link.center_latitude == null || link.center_longitude == null || link.radius_meters == null) {
      return validationResponse("Ce lien doit être renouvelé par l’administration.", 410);
    }
    const { data: departments, error } = await getSupabaseAdmin().from("departments")
      .select("id,name").in("id", link.department_ids as string[]).eq("status", "active").order("name");
    if (error) throw error;
    return NextResponse.json({
      meeting: { name: link.event_name, date: link.event_date, radius_meters: link.radius_meters },
      departments: departments ?? [],
    }, { headers: noStore() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { token } = await context.params;
    const link = await getLink(token);
    if (!link) return validationResponse("Ce lien de confirmation est invalide ou expiré.", 410);
    if (link.center_latitude == null || link.center_longitude == null || link.radius_meters == null) {
      return validationResponse("Ce lien doit être renouvelé par l’administration.", 410);
    }
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) return validationResponse(parsed.error.issues[0]?.message ?? "Vérifiez les informations saisies.");

    const supabase = getSupabaseAdmin();
    if (!await allowRequest(link.id, link.token_hash, request, parsed.data.action)) {
      return validationResponse("Trop de tentatives. Réessayez dans une minute.", 429);
    }

    if (parsed.data.action === "send_code") {
      if (!attendanceOtpConfigured()) {
        return validationResponse("La vérification par e-mail n’est pas encore configurée. Demandez à l’administration d’enregistrer votre présence.", 503);
      }
      const { department_id, full_name, email } = parsed.data;
      const genericMessage = parsed.data.intent === "decline"
        ? "Si les informations correspondent à une présence éligible, un code a été envoyé à l’adresse enregistrée. Après vérification du code, le statut sera marqué absent."
        : "Si les informations correspondent à une présence éligible et que la position est dans le périmètre, un code a été envoyé à l’adresse enregistrée. Sinon, contactez l’administration.";
      if (!(link.department_ids as string[]).includes(department_id)) {
        return NextResponse.json({ challenge_id: randomUUID(), message: genericMessage }, { status: 202, headers: noStore() });
      }
      if (parsed.data.intent === "confirm") {
        const { latitude, longitude, accuracy_meters } = parsed.data;
        if (latitude == null || longitude == null || accuracy_meters == null) return validationResponse("La position GPS précise est obligatoire.");
        const distance = distanceInMeters(link.center_latitude, link.center_longitude, latitude, longitude);
        if (accuracy_meters > 30 || distance > link.radius_meters) {
          return NextResponse.json({ challenge_id: randomUUID(), message: genericMessage }, { status: 202, headers: noStore() });
        }
      }

      const submittedName = normalizedName(full_name);
      const submittedEmail = email.trim().toLocaleLowerCase("fr");
      const { data: attendanceRows, error: attendanceError } = await supabase.from("attendance")
        .select("id,member_id,self_confirmed_at,self_declined_at")
        .eq("event_name", link.event_name).eq("event_date", link.event_date)
        .eq("statut_presence", "present").eq("department_id", department_id).limit(1500);
      if (attendanceError) throw attendanceError;

      const attendanceIds = (attendanceRows ?? []).filter((row) => !row.self_confirmed_at && !row.self_declined_at);
      const memberIds = [...new Set(attendanceIds.map((row) => row.member_id))];
      const { data: members, error: membersError } = memberIds.length
        ? await supabase.from("members").select("id,nom,postnom,prenom,email,status").in("id", memberIds).eq("status", "active")
        : { data: [], error: null };
      if (membersError) throw membersError;

      const memberById = new Map((members ?? []).map((member) => [member.id, member]));
      const candidates = attendanceIds.filter((row) => {
        const member = memberById.get(row.member_id);
        if (!member || !member.email) return false;
        const recordedName = normalizedName([member.nom, member.postnom, member.prenom].filter(Boolean).join(" "));
        return recordedName === submittedName && member.email.trim().toLocaleLowerCase("fr") === submittedEmail;
      });

      const challengeId = randomUUID();
      if (candidates.length === 1) {
        const attendance = candidates[0];
        const member = memberById.get(attendance.member_id);
        const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
        const otpHash = hashAttendanceOtp(link.id, challengeId, attendance.id, code);
        const { data: created, error: createError } = await supabase.rpc("create_attendance_confirmation_otp", {
          p_challenge_id: challengeId,
          p_link_id: link.id,
          p_attendance_id: attendance.id,
          p_code_hash: otpHash,
          p_outcome: parsed.data.intent,
          p_latitude: parsed.data.intent === "confirm" ? parsed.data.latitude : null,
          p_longitude: parsed.data.intent === "confirm" ? parsed.data.longitude : null,
          p_accuracy_meters: parsed.data.intent === "confirm" ? parsed.data.accuracy_meters : null,
        });
        if (createError) throw createError;
        if (created && member?.email) {
          const mail = { email: member.email, code, eventName: link.event_name, eventDate: link.event_date };
          const challenge = challengeId;
          after(async () => {
            try {
              await sendAttendanceOtp(mail.email, mail.code, mail.eventName, mail.eventDate);
            } catch (mailError) {
              console.error("Échec d’envoi du code de présence", mailError instanceof Error ? mailError.message : "erreur inconnue");
              try {
                await getSupabaseAdmin().from("attendance_confirmation_otps")
                  .update({ invalidated_at: new Date().toISOString() }).eq("id", challenge);
              } catch { /* invalidation best effort */ }
            }
          });
        }
      }

      return NextResponse.json({
        challenge_id: challengeId,
        message: genericMessage + " Vérifiez aussi vos courriers indésirables. Sinon, contactez l’administration.",
      }, { status: 202, headers: noStore() });
    }

    const { challenge_id, code, latitude, longitude, accuracy_meters, intent } = parsed.data;
    const { data: challenge, error: challengeError } = await supabase.from("attendance_confirmation_otps")
      .select("attendance_id,requested_outcome").eq("id", challenge_id).eq("confirmation_link_id", link.id).maybeSingle();
    if (challengeError) throw challengeError;
    if (!challenge || challenge.requested_outcome !== intent) return validationResponse("Code invalide ou expiré. Vérifiez le code reçu et réessayez.", 400);

    const otpHash = hashAttendanceOtp(link.id, challenge_id, challenge.attendance_id, code);
    const { data: result, error: verifyError } = await supabase.rpc("verify_attendance_confirmation_otp", {
      p_challenge_id: challenge_id,
      p_link_id: link.id,
      p_code_hash: otpHash,
      p_latitude: intent === "confirm" ? latitude : null,
      p_longitude: intent === "confirm" ? longitude : null,
      p_accuracy_meters: intent === "confirm" ? accuracy_meters : null,
    });
    if (verifyError) throw verifyError;
    if (result !== "confirmed" && result !== "already_confirmed" && result !== "declined" && result !== "already_declined") {
      return validationResponse(result === "locked"
        ? "Trop de codes incorrects. Demandez un nouveau code à l’administration."
        : "Code invalide ou expiré. Vérifiez le code reçu et réessayez.", result === "locked" ? 429 : 400);
    }

    if (result === "confirmed" || result === "declined") {
      const { error: auditError } = await supabase.from("audit_logs").insert({
        action: result === "declined" ? "attendance.worker_declined_confirmation" : "attendance.worker_confirmed",
        object_type: "attendance",
        object_id: challenge.attendance_id,
        context: { confirmation_link_id: link.id, event_name: link.event_name, event_date: link.event_date, location_captured: true },
      });
      if (auditError) console.error("Échec du journal de confirmation de présence", auditError.message);
    }
    return NextResponse.json({
      confirmed: result !== "declined" && result !== "already_declined",
      declined: result === "declined" || result === "already_declined",
      already_confirmed: result === "already_confirmed",
    }, { headers: noStore() });
  } catch (error) {
    return errorResponse(error);
  }
}

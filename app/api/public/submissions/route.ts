import { createHash, createHmac, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { errorResponse, validationResponse } from "@/lib/api/respond";
import { registrationSchema } from "@/lib/validation/registration";
import { registrationTokenPattern } from "@/lib/registration-token";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

function imageKind(bytes: Uint8Array): { ext: string; mime: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { ext: "webp", mime: "image/webp" };
  return null;
}

export async function POST(request: NextRequest) {
  let uploadedPath: string | null = null;
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_PHOTO_BYTES + 120_000) return validationResponse("La photo dépasse la taille maximale de 2 Mo.", 413);
    const form = await request.formData();
    if (String(form.get("website") ?? "").trim()) return validationResponse("Soumission invalide.", 400);
    const token = String(form.get("token") ?? "");
    const requestId = String(form.get("requestId") ?? "");
    if (!registrationTokenPattern.test(token) || !/^[0-9a-f-]{36}$/i.test(requestId)) {
      return validationResponse("Lien ou référence de soumission invalide.", 400);
    }
    const departmentValue = form.get("departments");
    const rawDepartments = Array.isArray(departmentValue) ? departmentValue : [];
    const departments = rawDepartments.length ? rawDepartments : form.getAll("departments").map(String);
    const raw = {
      nom: String(form.get("nom") ?? ""), postnom: String(form.get("postnom") ?? ""),
      prenom: String(form.get("prenom") ?? ""), sexe: String(form.get("sexe") ?? ""),
      date_naissance: String(form.get("date_naissance") ?? ""), etat_civil: String(form.get("etat_civil") ?? ""),
      telephone: String(form.get("telephone") ?? ""), telephone_secondaire: String(form.get("telephone_secondaire") ?? ""),
      adresse: String(form.get("adresse") ?? ""), commune: String(form.get("commune") ?? ""), quartier: String(form.get("quartier") ?? ""),
      email: String(form.get("email") ?? ""), frequentation_depuis: String(form.get("frequentation_depuis") ?? ""),
      date_debut_service: String(form.get("date_debut_service") ?? ""), fonction: String(form.get("fonction") ?? ""),
      responsable_actuel: String(form.get("responsable_actuel") ?? ""), observations: String(form.get("observations") ?? ""),
      departments: form.getAll("departments").map(String),
      exactitude_confirmee: String(form.get("exactitude_confirmee") ?? ""),
    };
    void departments;
    const parsed = registrationSchema.safeParse(raw);
    if (!parsed.success) return validationResponse(parsed.error.issues[0]?.message ?? "Vérifiez les champs du formulaire.");

    const supabase = getSupabaseAdmin();
    const salt = process.env.INITIAL_ADMIN_SETUP_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
    if (!salt) throw new Error("Configuration serveur manquante");
    const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ipHash = createHmac("sha256", salt).update(forwardedIp).digest("hex");
    const { data: allowed, error: rateError } = await supabase.rpc("consume_public_submission_rate", { p_ip_hash: ipHash });
    if (rateError) throw rateError;
    if (!allowed) return validationResponse("Trop de tentatives. Réessayez dans une minute.", 429);

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const selectedIds = [...new Set(parsed.data.departments)];
    const { data: validDepartments, error: departmentError } = await supabase.from("departments")
      .select("id").in("id", selectedIds).eq("status", "active");
    if (departmentError) throw departmentError;
    if ((validDepartments?.length ?? 0) !== selectedIds.length) return validationResponse("Un département sélectionné n’est plus disponible.");

    const photo = form.get("photo");
    if (photo instanceof File && photo.size > 0) {
      if (photo.size > MAX_PHOTO_BYTES) return validationResponse("La photo dépasse la taille maximale de 2 Mo.", 413);
      const bytes = new Uint8Array(await photo.arrayBuffer());
      const kind = imageKind(bytes);
      if (!kind || !["image/jpeg", "image/png", "image/webp"].includes(photo.type)) {
        return validationResponse("Format de photo non accepté. Utilisez JPEG, PNG ou WebP.");
      }
      uploadedPath = `submissions/${randomUUID()}.${kind.ext}`;
      const { error: uploadError } = await supabase.storage.from("church-profiles").upload(uploadedPath, bytes, {
        contentType: kind.mime, cacheControl: "3600", upsert: false,
      });
      if (uploadError) throw uploadError;
    }

    const { departments: _departments, exactitude_confirmee: _confirmed, ...data } = parsed.data;
    const { data: result, error: submitError } = await supabase.rpc("submit_worker_application", {
      p_token_hash: tokenHash,
      p_request_id: requestId,
      p_data: data,
      p_department_ids: selectedIds,
      p_photo_path: uploadedPath,
    });
    if (submitError) {
      if (uploadedPath) await supabase.storage.from("church-profiles").remove([uploadedPath]);
      if (submitError.message.includes("LINK_INVALID") || submitError.message.includes("LINK_LIMIT_REACHED")) {
        return validationResponse("Ce lien est expiré ou a atteint sa limite d’utilisation.", 410);
      }
      throw submitError;
    }
    try {
      const [admins, readers] = await Promise.all([
        supabase.from("profiles").select("id").eq("role", "super_admin").eq("status", "active"),
        supabase.from("profile_permissions").select("profile_id").eq("permission_key", "submissions.read"),
      ]);
      if (admins.error) throw admins.error;
      if (readers.error) throw readers.error;
      const readerIds = [...new Set((readers.data ?? []).map((profile) => profile.profile_id))];
      const { data: activeReaders, error: activeError } = readerIds.length
        ? await supabase.from("profiles").select("id").in("id", readerIds).eq("status", "active")
        : { data: [], error: null };
      if (activeError) throw activeError;
      const recipients = [...new Set([...(admins.data ?? []).map((profile) => profile.id), ...(activeReaders ?? []).map((profile) => profile.id)])];
      await sendPushToUsers(recipients, {
        title: "Nouveau formulaire d’ouvrier",
        body: `Un dossier ${result.reference_number} attend une vérification.`,
        url: "/admin/submissions",
        tag: `submission-${result.reference_number}`,
      });
    } catch (pushError) {
      console.error("Notification de nouvelle inscription non délivrée", pushError instanceof Error ? pushError.message : "erreur inconnue");
    }
    return NextResponse.json({ reference: result.reference_number }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (uploadedPath) {
      try { await getSupabaseAdmin().storage.from("church-profiles").remove([uploadedPath]); } catch { /* best-effort cleanup */ }
    }
    return errorResponse(error);
  }
}

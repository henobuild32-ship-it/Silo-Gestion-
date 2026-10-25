import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { bootstrapSchema } from "@/lib/validation/registration";
import { errorResponse, validationResponse } from "@/lib/api/respond";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const parsed = bootstrapSchema.safeParse(await request.json());
    if (!parsed.success) return validationResponse(parsed.error.issues[0]?.message ?? "Informations invalides.");
    const configuredKey = process.env.INITIAL_ADMIN_SETUP_KEY;
    if (!configuredKey || configuredKey.length < 32) {
      return validationResponse("La clé de première installation n’est pas configurée sur le serveur.", 503);
    }
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ipHash = createHmac("sha256", configuredKey).update(ip).digest("hex");
    const { data: allowed, error: rateError } = await getSupabaseAdmin().rpc("consume_public_submission_rate", { p_ip_hash: `setup:${ipHash}` });
    if (rateError) throw rateError;
    if (!allowed) return validationResponse("Trop de tentatives. Réessayez dans une minute.", 429);
    const received = Buffer.from(parsed.data.setupKey);
    const expected = Buffer.from(configuredKey);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      return validationResponse("Clé de première installation invalide.", 403);
    }

    const supabase = getSupabaseAdmin();
    const { data: existing, error: lookupError } = await supabase.from("profiles")
      .select("id").eq("role", "super_admin").limit(1);
    if (lookupError) throw lookupError;
    if (existing?.length) return validationResponse("L’administrateur principal a déjà été créé.", 409);

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: { full_name: parsed.data.fullName },
    });
    if (createError || !created.user) return validationResponse(createError?.message ?? "Création du compte impossible.", 400);

    const { error: profileError } = await supabase.from("profiles").insert({
      id: created.user.id,
      full_name: parsed.data.fullName,
      role: "super_admin",
      status: "active",
    });
    if (profileError) {
      await supabase.auth.admin.deleteUser(created.user.id);
      if (profileError.code === "23505") return validationResponse("L’administrateur principal a déjà été créé.", 409);
      throw profileError;
    }

    const { error: auditError } = await supabase.from("audit_logs").insert({
      user_id: created.user.id,
      action: "bootstrap.super_admin.created",
      object_type: "profile",
      object_id: created.user.id,
    });
    if (auditError) console.error("Échec du journal de création de l’administrateur principal", auditError.message);
    return NextResponse.json({ message: "Administrateur principal créé. Vous pouvez maintenant vous connecter." }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { requirePermission } from "@/lib/api/auth";
import { errorResponse, validationResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const schema = z.object({
  action: z.enum(["reviewing", "needs_changes", "rejected", "approved"]),
  departmentIds: z.array(z.string().uuid()).max(13).default([]),
  reason: z.string().trim().max(1000).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission(request, "submissions.validate");
    const { id } = await params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return validationResponse(parsed.error.issues[0]?.message ?? "Action invalide.");
    if (["needs_changes", "rejected"].includes(parsed.data.action) && !parsed.data.reason) {
      return validationResponse("Indiquez le motif ou les corrections demandées.");
    }
    if (parsed.data.action === "approved" && parsed.data.departmentIds.length < 1) {
      return validationResponse("Confirmez au moins un département avant de valider.");
    }
    const supabase = getSupabaseAdmin();
    if (parsed.data.action === "needs_changes") {
      const editToken = randomBytes(16).toString("base64url");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase.rpc("request_worker_submission_correction", {
        p_submission_id: id,
        p_actor_id: auth.userId,
        p_reason: parsed.data.reason,
        p_token_hash: createHash("sha256").update(editToken).digest("hex"),
        p_expires_at: expiresAt,
      });
      if (error) {
        if (error.message.includes("SUBMISSION_NOT_FOUND")) return validationResponse("Formulaire introuvable.", 404);
        if (error.message.includes("ALREADY_CLOSED")) return validationResponse("Ce dossier a déjà été clôturé.", 409);
        throw error;
      }
      const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || request.nextUrl.origin;
      return NextResponse.json({ result: data, editLink: `${appUrl}/i/${editToken}`, editLinkExpiresAt: expiresAt });
    }

    const { data, error } = await supabase.rpc("review_worker_submission", {
      p_submission_id: id,
      p_actor_id: auth.userId,
      p_action: parsed.data.action,
      p_department_ids: parsed.data.departmentIds,
      p_review_data: {},
      p_reason: parsed.data.reason ?? null,
    });
    if (error) {
      if (error.message.includes("POSSIBLE_DUPLICATE")) return validationResponse("Doublon potentiel : comparez cette demande aux fiches existantes avant toute fusion.", 409);
      if (error.message.includes("SUBMISSION_NOT_FOUND")) return validationResponse("Formulaire introuvable.", 404);
      if (error.message.includes("ALREADY_CLOSED")) return validationResponse("Ce dossier a déjà été clôturé.", 409);
      if (error.message.includes("DEPARTMENT_NOT_REQUESTED")) return validationResponse("Un département confirmé ne fait pas partie des choix soumis.");
      throw error;
    }
    return NextResponse.json({ result: data });
  } catch (error) {
    return errorResponse(error);
  }
}

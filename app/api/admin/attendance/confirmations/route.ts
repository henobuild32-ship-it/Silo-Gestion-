import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasProfilePermission, requireDepartmentAccess, requirePermission } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/auth";
import { errorResponse, validationResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const schema = z.object({
  event_name: z.string().trim().min(1).max(120),
  event_date: z.string().date(),
  department_id: z.string().uuid().nullable().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePermission(request, "attendance.write");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return validationResponse(parsed.error.issues[0]?.message ?? "Réunion invalide.");
    const supabase = getSupabaseAdmin();
    const canReadAll = auth.role === "super_admin" || await hasProfilePermission(auth, "attendance.read_all");
    let allowedDepartmentIds = auth.departmentIds;
    if (canReadAll) {
      const { data, error } = await supabase.from("departments").select("id").eq("status", "active");
      if (error) throw error;
      allowedDepartmentIds = (data ?? []).map((item) => item.id);
    }
    if (parsed.data.department_id) {
      await requireDepartmentAccess(auth, parsed.data.department_id);
      allowedDepartmentIds = allowedDepartmentIds.includes(parsed.data.department_id) || canReadAll
        ? [parsed.data.department_id]
        : [];
    }
    if (!allowedDepartmentIds.length) throw new ApiError(403, "Aucun département autorisé pour cette réunion.");

    const { count: attendeeCount, error: attendanceError } = await supabase.from("attendance")
      .select("id", { count: "exact", head: true })
      .eq("event_date", parsed.data.event_date)
      .eq("event_name", parsed.data.event_name)
      .eq("statut_presence", "present")
      .in("department_id", allowedDepartmentIds);
    if (attendanceError) throw attendanceError;
    if (!attendeeCount) return validationResponse("Aucun pointage « Présent » ne correspond à cette réunion, cette date et ce département.", 404);

    const rawToken = randomBytes(18).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: link, error: linkError } = await supabase.from("attendance_confirmation_links").insert({
      token_hash: tokenHash,
      event_name: parsed.data.event_name,
      event_date: parsed.data.event_date,
      department_ids: allowedDepartmentIds,
      created_by: auth.userId,
      expires_at: expiresAt,
    }).select("id").single();
    if (linkError) throw linkError;

    const { error: auditError } = await supabase.from("audit_logs").insert({
      user_id: auth.userId,
      action: "attendance.confirmation_link_created",
      object_type: "attendance_confirmation_link",
      object_id: link.id,
      context: { event_name: parsed.data.event_name, event_date: parsed.data.event_date, attendee_count: attendeeCount },
    });
    if (auditError) console.error("Échec du journal de création du lien de présence", auditError.message);

    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin).replace(/\/$/, "");
    return NextResponse.json({
      url: `${baseUrl}/c/${rawToken}`,
      attendee_count: attendeeCount,
      event_name: parsed.data.event_name,
      event_date: parsed.data.event_date,
      expires_at: expiresAt,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

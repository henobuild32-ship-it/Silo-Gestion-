import "server-only";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type AppRole = "super_admin" | "secretariat" | "department_lead";
export type AuthContext = {
  userId: string;
  email: string;
  fullName: string;
  role: AppRole;
  departmentIds: string[];
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function getAuthContext(request: NextRequest): Promise<AuthContext> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new ApiError(401, "Session requise.");

  const supabase = getSupabaseAdmin();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) throw new ApiError(401, "Session invalide ou expirée.");

  const [{ data: profile, error: profileError }, { data: departments }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role, status").eq("id", authData.user.id).maybeSingle(),
    supabase.from("profile_departments").select("department_id").eq("profile_id", authData.user.id),
  ]);
  if (profileError || !profile || profile.status !== "active") throw new ApiError(403, "Compte inactif ou non autorisé.");
  return {
    userId: authData.user.id,
    email: authData.user.email ?? "",
    fullName: profile.full_name,
    role: profile.role,
    departmentIds: (departments ?? []).map((item) => item.department_id),
  };
}

export async function requirePermission(request: NextRequest, permission: string): Promise<AuthContext> {
  const auth = await getAuthContext(request);
  if (!await hasProfilePermission(auth, permission)) throw new ApiError(403, "Vous ne disposez pas de cette autorisation.");
  return auth;
}

export async function hasProfilePermission(auth: AuthContext, permission: string): Promise<boolean> {
  if (auth.role === "super_admin") return true;
  const { data } = await getSupabaseAdmin().from("profile_permissions").select("permission_key")
    .eq("profile_id", auth.userId).eq("permission_key", permission).maybeSingle();
  return Boolean(data);
}

export async function requireAnyPermission(request: NextRequest, permissions: string[]): Promise<AuthContext> {
  const auth = await getAuthContext(request);
  const granted = await Promise.all(permissions.map((permission) => hasProfilePermission(auth, permission)));
  if (!granted.some(Boolean)) throw new ApiError(403, "Vous ne disposez pas de cette autorisation.");
  return auth;
}

export async function requireDepartmentAccess(auth: AuthContext, departmentId: string): Promise<void> {
  if (auth.role === "super_admin") return;
  if (auth.departmentIds.includes(departmentId)) return;
  const { data } = await getSupabaseAdmin().from("profile_permissions").select("permission_key")
    .eq("profile_id", auth.userId).eq("permission_key", "departments.read_all").maybeSingle();
  if (!data) throw new ApiError(403, "Département hors de votre périmètre.");
}

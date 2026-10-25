import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/api/auth";
import { errorResponse, validationResponse } from "@/lib/api/respond";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const financeSchema = z.object({
  type_operation: z.enum(["income", "expense"]), montant: z.number().positive().max(999999999999), devise: z.string().length(3).toUpperCase(),
  categorie: z.string().trim().min(2).max(80), motif: z.string().trim().min(2).max(500), department_id: z.string().uuid().nullable().optional(), operation_date: z.string().date(),
});

export async function GET(request: NextRequest) {
  try {
    await requirePermission(request, "finance.read");
    const supabase = getSupabaseAdmin();
    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");
    let query = supabase.from("financial_transactions").select("id,type_operation,montant,devise,categorie,motif,department_id,operation_date,status,created_by,created_at")
      .order("operation_date", { ascending: false }).limit(500);
    if (from) query = query.gte("operation_date", from);
    if (to) query = query.lte("operation_date", to);
    const [{ data, error }, { data: totals, error: totalsError }] = await Promise.all([query, supabase.rpc("get_financial_balances")]);
    if (error) throw error;
    if (totalsError) throw totalsError;
    const departmentIds = [...new Set((data ?? []).map((item) => item.department_id).filter(Boolean))] as string[];
    const { data: departments, error: deptError } = departmentIds.length ? await supabase.from("departments").select("id,name").in("id", departmentIds) : { data: [], error: null };
    if (deptError) throw deptError;
    const names = new Map((departments ?? []).map((item) => [item.id, item.name]));
    const totalRows = (totals ?? []) as { devise: string; income: string; expense: string; balance: string }[];
    return NextResponse.json({ transactions: (data ?? []).map((item) => ({ ...item, department_name: item.department_id ? names.get(item.department_id) : "Général" })), totals: Object.fromEntries(totalRows.map((item) => [item.devise, { income: item.income, expense: item.expense, balance: item.balance }])) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePermission(request, "finance.write");
    const parsed = financeSchema.safeParse(await request.json());
    if (!parsed.success) return validationResponse(parsed.error.issues[0]?.message ?? "Opération financière invalide.");
    const { data, error } = await getSupabaseAdmin().rpc("create_financial_transaction_with_audit", { p_actor_id: auth.userId, p_data: parsed.data });
    if (error) throw error;
    return NextResponse.json({ transaction: data }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

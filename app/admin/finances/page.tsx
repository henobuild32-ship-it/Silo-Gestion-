"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Coins, Plus, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { apiFetch } from "@/lib/api/client";

type Transaction = { id: string; type_operation: string; montant: string; devise: string; categorie: string; motif: string; department_name: string; operation_date: string; status: string };
type FinanceData = { transactions: Transaction[]; totals: Record<string, { income: string; expense: string; balance: string }> };
const currencies = ["USD", "CDF", "EUR"];

export default function FinancesPage() {
  const [data, setData] = useState<FinanceData>({ transactions: [], totals: {} });
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  async function load() {
    setLoading(true); setError("");
    try {
      const [finance, me, dept] = await Promise.all([
        apiFetch<FinanceData>("/api/admin/finances"), apiFetch<{ permissions: string[] }>("/api/admin/me"),
        apiFetch<{ departments: { id: string; name: string }[] }>("/api/admin/departments").catch(() => ({ departments: [] })),
      ]);
      setData(finance); setCanWrite(me.permissions.includes("finance.write")); setDepartments(dept.departments);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de charger les opérations financières."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); const value = Object.fromEntries(form.entries());
    setBusy(true); setError("");
    try { await apiFetch("/api/admin/finances", { method: "POST", body: JSON.stringify({ ...value, montant: Number(value.montant), department_id: value.department_id || null }) }); formElement.reset(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "L’opération n’a pas pu être enregistrée."); }
    finally { setBusy(false); }
  }
  const currencyFormat = (value: string, currency: string) => `${value} ${currency}`;

  return <AdminShell title="Finances"><div className="admin-content">
    <div className="page-heading"><div><h1>Finances</h1><p>Recettes et dépenses, avec un solde calculé séparément pour chaque devise.</p></div><button className="button secondary small" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Actualiser</button></div>
    {error && <div className="notice error" style={{ marginBottom: 14 }}>{error}</div>}
    <div className="stat-grid">{loading && !Object.keys(data.totals).length ? <div className="card stat-card"><div className="spinner" /></div> : Object.entries(data.totals).map(([currency, total]) => <article className="card stat-card" key={currency}><div className="stat-top"><span>Solde cumulé · {currency}</span><span className="stat-icon"><Coins size={18} /></span></div><div className="stat-value" style={{ fontSize: 23 }}>{currencyFormat(total.balance, currency)}</div><div className="stat-foot">Entrées {total.income} · Sorties {total.expense}</div></article>)}</div>
    {canWrite && <form className="card panel" onSubmit={(event) => void create(event)} style={{ marginBottom: 17 }}><div className="panel-heading"><div><h2>Enregistrer une opération</h2><div className="field-hint" style={{ marginTop: 3 }}>Toute opération et son journal d’audit sont enregistrés dans une transaction.</div></div><Plus size={18} color="#658775" /></div>
      <div className="form-grid"><div className="field"><label>Type *</label><select name="type_operation"><option value="income">Recette</option><option value="expense">Dépense</option></select></div><div className="field"><label>Montant *</label><input name="montant" type="number" min="0.01" max="999999999999" step="0.01" required /></div><div className="field"><label>Devise *</label><select name="devise">{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></div><div className="field"><label>Catégorie *</label><input name="categorie" maxLength={80} required placeholder="Offrande, transport…" /></div><div className="field"><label>Date *</label><input name="operation_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></div><div className="field"><label>Département</label><select name="department_id"><option value="">Général</option>{departments.map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}</select></div><div className="field span-2"><label>Motif *</label><input name="motif" required maxLength={500} /></div></div>
      <button className="button small" style={{ marginTop: 13 }} disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer l’opération"}</button>
    </form>}
    <section className="card panel"><div className="panel-heading"><div><h2>Opérations récentes</h2><div className="field-hint" style={{ marginTop: 3 }}>Montants présentés dans leur devise d’origine.</div></div><Coins size={18} color="#658775" /></div>
      {loading && !data.transactions.length ? <div className="empty-state"><div className="spinner" style={{ margin: "auto" }} /></div> : data.transactions.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Opération</th><th>Catégorie / motif</th><th>Département</th><th>Montant</th><th>Statut</th></tr></thead><tbody>{data.transactions.map((item) => <tr key={item.id}><td>{new Date(item.operation_date).toLocaleDateString("fr-FR")}</td><td><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{item.type_operation === "income" ? <ArrowUpRight size={15} color="#397052" /> : <ArrowDownRight size={15} color="#a7433b" />}{item.type_operation === "income" ? "Recette" : "Dépense"}</span></td><td><strong>{item.categorie}</strong><div className="field-hint">{item.motif}</div></td><td>{item.department_name}</td><td style={{ fontWeight: 800 }}>{item.montant} {item.devise}</td><td><span className={`badge ${item.status === "posted" ? "approved" : "rejected"}`}>{item.status === "posted" ? "Comptabilisé" : "Annulé"}</span></td></tr>)}</tbody></table></div> : <div className="empty-state"><Coins size={25} /><strong>Aucune opération enregistrée</strong>Les opérations autorisées apparaîtront ici.</div>}
    </section>
  </div></AdminShell>;
}

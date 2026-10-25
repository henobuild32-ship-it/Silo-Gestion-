"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Printer, Search } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

const reportNames: Record<string, string> = { workers: "Liste des ouvriers", members: "Liste générale des membres", attendance: "Rapport des présences", activities: "Rapport des activités", finance: "Rapport financier" };
type Department = { id: string; name: string };
type ReportPayload = { headers: string[]; rows: string[][] };

export default function ReportsPage() {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [role, setRole] = useState("");
  const [type, setType] = useState("workers");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ReportPayload | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  useEffect(() => {
    getSupabaseBrowser().auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const response = await fetch("/api/admin/me", { headers: { Authorization: `Bearer ${data.session.access_token}` } });
      if (!response.ok) throw new Error("Impossible de lire les autorisations.");
      const me = await response.json(); setPermissions(me.permissions); setRole(me.role);
      if (me.role === "super_admin" || me.permissions.includes("attendance.read_all") || me.permissions.includes("attendance.read_assigned")) {
        const attendanceResponse = await fetch("/api/admin/attendance", { headers: { Authorization: `Bearer ${data.session.access_token}` } });
        if (attendanceResponse.ok) { const attendance = await attendanceResponse.json(); setDepartments(attendance.departments ?? []); }
      }
    }).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, []);
  const options = useMemo(() => {
    const allowed = (key: string) => role === "super_admin" || permissions.includes(key);
    return Object.entries(reportNames).filter(([key]) => key === "finance" ? allowed("finance.read") : key === "attendance" ? allowed("attendance.read_all") || allowed("attendance.read_assigned") : key === "activities" ? allowed("activities.read_all") || allowed("activities.read_assigned") : allowed("members.read_all") || allowed("members.read_assigned"));
  }, [permissions, role]);

  async function getReport() {
    setBusy(true); setError("");
    try {
      const { data } = await getSupabaseBrowser().auth.getSession();
      const params = new URLSearchParams({ type });
      if (type === "attendance") {
        if (dateFrom) params.set("date_from", dateFrom);
        if (dateTo) params.set("date_to", dateTo);
        if (departmentId) params.set("department_id", departmentId);
        if (eventFilter.trim()) params.set("event", eventFilter.trim());
        if (statusFilter) params.set("status", statusFilter);
      }
      const response = await fetch(`/api/admin/reports?${params}`, { headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {} });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Impossible de générer le rapport.");
      setPreview(body as ReportPayload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de générer le rapport."); }
    finally { setBusy(false); }
  }

  function printReport() {
    if (!preview) return;
    const popup = window.open("", "_blank");
    if (!popup) { setError("Autorisez l’ouverture de la fenêtre d’impression."); return; }
    const doc = popup.document;
    doc.open(); doc.write("<!doctype html><html lang='fr'><head><meta charset='utf-8'><title>Rapport Silo Vert Ouvriers</title></head><body></body></html>"); doc.close();
    doc.body.style.cssText = "font:12px Arial,sans-serif;color:#172c29;padding:24px";
    const brand = doc.createElement("header"); brand.style.cssText = "display:flex;align-items:center;gap:14px;margin-bottom:20px";
    const logo = doc.createElement("img"); logo.src = "/silo-logo.png"; logo.alt = "Logo du Centre Évangélique Silo"; logo.style.cssText = "width:64px;height:64px;object-fit:contain";
    const identity = doc.createElement("div"); identity.style.cssText = "display:grid;gap:4px";
    const church = doc.createElement("strong"); church.textContent = "SILO VERT OUVRIERS"; church.style.fontSize = "16px";
    const campus = doc.createElement("span"); campus.textContent = "Centre Évangélique Silo · Campus de la Cité Verte"; campus.style.color = "#65736d";
    identity.append(church, campus); brand.append(logo, identity); doc.body.append(brand);
    const title = doc.createElement("h1"); title.textContent = reportNames[type]; title.style.cssText = "font-size:20px;margin:0 0 6px"; doc.body.append(title);
    const date = doc.createElement("p"); date.textContent = `Généré le ${new Date().toLocaleString("fr-FR")}${type === "attendance" && (dateFrom || dateTo) ? ` · Période : ${dateFrom || "début"} — ${dateTo || "aujourd’hui"}` : ""}`; date.style.cssText = "color:#65736d;font-size:11px;margin:0 0 16px"; doc.body.append(date);
    const table = doc.createElement("table"); table.style.cssText = "width:100%;border-collapse:collapse;font-size:10px";
    const head = doc.createElement("thead"); const headerRow = doc.createElement("tr");
    preview.headers.forEach((value) => { const cell = doc.createElement("th"); cell.textContent = value; cell.style.cssText = "border:1px solid #dce4de;padding:6px;text-align:left;background:#edf4ef"; headerRow.append(cell); }); head.append(headerRow); table.append(head);
    const body = doc.createElement("tbody");
    preview.rows.forEach((row) => { const tr = doc.createElement("tr"); row.forEach((value) => { const cell = doc.createElement("td"); cell.textContent = value; cell.style.cssText = "border:1px solid #dce4de;padding:6px;text-align:left;vertical-align:top"; tr.append(cell); }); body.append(tr); });
    table.append(body); doc.body.append(table); popup.focus(); window.setTimeout(() => popup.print(), 350);
  }

  return <AdminShell title="Rapports"><div className="admin-content">
    <div className="page-heading"><div><h1>Rapports et impressions</h1><p>Les rapports suivent les mêmes périmètres d’accès que les listes de gestion.</p></div></div>
    {error && <div className="notice error" style={{ marginBottom: 14 }}>{error}</div>}
    <section className="card panel" style={{ maxWidth: 1020 }}><div className="panel-heading"><div><h2>Consulter et imprimer un rapport</h2><div className="field-hint" style={{ marginTop: 4 }}>Affichez la liste ici, puis imprimez-la ou choisissez « Enregistrer en PDF » dans la fenêtre d’impression.</div></div><FileText size={20} color="#658775" /></div>
      {loading ? <div className="empty-state"><div className="spinner" style={{ margin: "auto" }} /></div> : options.length ? <><div className="field" style={{ maxWidth: 420 }}><label htmlFor="report-type">Type de rapport</label><select id="report-type" value={type} onChange={(event) => { setType(event.target.value); setPreview(null); }}>{options.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></div>
        {type === "attendance" && <div className="report-filter-grid"><div className="field"><label htmlFor="report-from">Du</label><input id="report-from" type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPreview(null); }} /></div><div className="field"><label htmlFor="report-to">Au</label><input id="report-to" type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPreview(null); }} /></div><div className="field"><label htmlFor="report-department">Département</label><select id="report-department" value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setPreview(null); }}><option value="">Tous mes départements</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="field"><label htmlFor="report-event">Réunion / événement</label><input id="report-event" value={eventFilter} maxLength={120} onChange={(event) => { setEventFilter(event.target.value); setPreview(null); }} placeholder="Nom ou partie du nom" /></div><div className="field"><label htmlFor="report-status">Statut</label><select id="report-status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPreview(null); }}><option value="">Tous les statuts</option><option value="present">Présent</option><option value="absent">Absent</option><option value="justified">Justifié</option></select></div></div>}
        <div className="notice" style={{ marginTop: 17 }}><FileText size={16} />Les informations visibles dépendent de vos autorisations. Les listes sont enregistrées uniquement en PDF ou imprimées. Chaque consultation est journalisée.</div><div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 18 }}><button className="button" onClick={() => void getReport()} disabled={busy}><Search size={15} />{busy ? "Préparation…" : "Afficher la liste"}</button><button className="button secondary" onClick={printReport} disabled={busy || !preview}><Printer size={15} />Imprimer / Enregistrer en PDF</button></div></> : <div className="empty-state"><FileText size={24} /><strong>Aucun rapport disponible</strong>Contactez l’administrateur pour obtenir les autorisations nécessaires.</div>}
    </section>
    {preview && <section className="card panel report-preview"><div className="panel-heading"><div><h2>{reportNames[type]}</h2><div className="field-hint">{preview.rows.length} ligne(s)</div></div><button className="button secondary small no-print" onClick={printReport}><Printer size={14} />PDF / Imprimer</button></div><div className="table-wrap"><table><thead><tr>{preview.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{preview.rows.map((row, index) => <tr key={`${index}-${row[0] ?? ""}`}>{preview?.headers.map((header, column) => <td key={`${header}-${column}`}>{row[column]}</td>)}</tr>)}</tbody></table>{!preview.rows.length && <div className="empty-state"><strong>Aucun résultat</strong>Aucune ligne ne correspond à ces critères.</div>}</div></section>}
  </div></AdminShell>;
}

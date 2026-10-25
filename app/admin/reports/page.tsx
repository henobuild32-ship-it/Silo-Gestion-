"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

const reportNames: Record<string, string> = { workers: "Liste des ouvriers", members: "Liste générale des membres", attendance: "Rapport des présences", activities: "Rapport des activités", finance: "Rapport financier" };

export default function ReportsPage() {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [role, setRole] = useState("");
  const [type, setType] = useState("workers");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getSupabaseBrowser().auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const response = await fetch("/api/admin/me", { headers: { Authorization: `Bearer ${data.session.access_token}` } });
      if (!response.ok) throw new Error("Impossible de lire les autorisations.");
      const me = await response.json(); setPermissions(me.permissions); setRole(me.role);
    }).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, []);
  const options = useMemo(() => {
    const allowed = (key: string) => role === "super_admin" || permissions.includes(key);
    return Object.entries(reportNames).filter(([key]) => key === "finance" ? allowed("finance.read") : key === "attendance" ? allowed("attendance.read_all") || allowed("attendance.read_assigned") : key === "activities" ? allowed("activities.read_all") || allowed("activities.read_assigned") : allowed("members.read_all") || allowed("members.read_assigned"));
  }, [permissions, role]);

  async function getReport() {
    const popup = window.open("", "_blank");
    if (!popup) { setError("Autorisez l’ouverture d’un nouvel onglet pour afficher le rapport."); return; }
    setBusy(true); setError("");
    try {
      const { data } = await getSupabaseBrowser().auth.getSession();
      const response = await fetch(`/api/admin/reports?type=${encodeURIComponent(type)}`, { headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {} });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? "Impossible de générer le rapport."); }
      const text = await response.text();
      const rows = parseCsv(text);
      const doc = popup.document;
      doc.open(); doc.write("<!doctype html><html lang='fr'><head><meta charset='utf-8'><title>Rapport SILO</title></head><body></body></html>"); doc.close();
      doc.body.style.cssText = "font:12px Arial,sans-serif;color:#172c29;padding:24px";
      const title = doc.createElement("h1"); title.textContent = `Centre Évangélique Silo — ${reportNames[type]}`; title.style.cssText = "font-size:18px;margin:0 0 6px"; doc.body.append(title);
      const date = doc.createElement("p"); date.textContent = `Campus de la Cité Verte · Généré le ${new Date().toLocaleString("fr-FR")}`; date.style.cssText = "color:#65736d;font-size:11px;margin:0 0 16px"; doc.body.append(date);
      const table = doc.createElement("table"); table.style.cssText = "width:100%;border-collapse:collapse;font-size:10px";
      rows.forEach((row, index) => { const tr = doc.createElement("tr"); row.forEach((value) => { const cell = doc.createElement(index === 0 ? "th" : "td"); cell.textContent = value; cell.style.cssText = `border:1px solid #dce4de;padding:6px;text-align:left;${index === 0 ? "background:#edf4ef;font-weight:bold" : ""}`; tr.append(cell); }); table.append(tr); });
      doc.body.append(table); popup.focus(); window.setTimeout(() => popup.print(), 350);
    } catch (reason) { popup.close(); setError(reason instanceof Error ? reason.message : "Impossible de générer le rapport."); }
    finally { setBusy(false); }
  }

  async function downloadCsv() {
    setBusy(true); setError("");
    try {
      const { data } = await getSupabaseBrowser().auth.getSession();
      const response = await fetch(`/api/admin/reports?type=${encodeURIComponent(type)}`, { headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {} });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? "Impossible de générer le rapport."); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${type}-silo.csv`; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de télécharger le rapport."); }
    finally { setBusy(false); }
  }

  return <AdminShell title="Rapports"><div className="admin-content">
    <div className="page-heading"><div><h1>Rapports & exportations</h1><p>Les exports utilisent les mêmes périmètres d’accès que les listes de gestion.</p></div></div>
    {error && <div className="notice error" style={{ marginBottom: 14 }}>{error}</div>}
    <section className="card panel" style={{ maxWidth: 850 }}><div className="panel-heading"><div><h2>Générer un rapport</h2><div className="field-hint" style={{ marginTop: 4 }}>L’export CSV s’ouvre dans Excel. L’aperçu peut être imprimé ou enregistré en PDF.</div></div><FileSpreadsheet size={20} color="#658775" /></div>
      {loading ? <div className="empty-state"><div className="spinner" style={{ margin: "auto" }} /></div> : options.length ? <><div className="field" style={{ maxWidth: 420 }}><label htmlFor="report-type">Type de rapport</label><select id="report-type" value={type} onChange={(event) => setType(event.target.value)}>{options.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></div><div className="notice" style={{ marginTop: 17 }}><FileSpreadsheet size={16} />Les informations personnelles sont incluses uniquement dans les rapports que votre rôle peut consulter. Chaque export est journalisé.</div><div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 18 }}><button className="button" onClick={() => void downloadCsv()} disabled={busy}><Download size={15} />{busy ? "Préparation…" : "Exporter pour Excel (CSV)"}</button><button className="button secondary" onClick={() => void getReport()} disabled={busy}><Printer size={15} />Aperçu · Impression / PDF</button></div></> : <div className="empty-state"><FileSpreadsheet size={24} /><strong>Aucun rapport disponible</strong>Contactez l’administrateur pour obtenir les autorisations nécessaires.</div>}
    </section>
  </div></AdminShell>;
}

function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, ""); const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted && char === '"' && source[index + 1] === '"') { field += '"'; index++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ";" && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && source[index + 1] === "\n") index++; row.push(field); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

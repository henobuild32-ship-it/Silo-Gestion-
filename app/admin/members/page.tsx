"use client";

import { FormEvent, useEffect, useState, type ChangeEvent } from "react";
import { ChevronDown, Download, Plus, Search, UserRound, X } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { apiFetch } from "@/lib/api/client";

type Member = { id: string; member_number: string; nom: string; postnom: string; prenom: string; sexe: string; telephone: string; commune: string; photo_url: string | null; categories: string[]; departments: { id: string; name: string; fonction: string | null }[] };
type Department = { id: string; name: string };
const categoryNames: Record<string, string> = { member: "Membre", worker: "Ouvrier", visitor: "Visiteur" };

export default function MembersPage() {
  const [department, setDepartment] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => { const timer = window.setTimeout(() => setSearch(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { setDepartment(new URLSearchParams(window.location.search).get("department") ?? ""); }, []);
  useEffect(() => { apiFetch<{ departments: Department[] }>("/api/admin/departments").then((result) => setDepartments(result.departments)).catch(() => undefined); }, []);
  useEffect(() => { void load(0); }, [search, department]);

  async function load(nextPage = page) {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(nextPage) });
      if (search) params.set("q", search);
      if (department) params.set("department", department);
      const result = await apiFetch<{ members: Member[]; total: number }>(`/api/admin/members?${params}`);
      setMembers((current) => nextPage ? [...current, ...result.members] : result.members); setTotal(result.total); setPage(nextPage);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de charger les fiches."); }
    finally { setLoading(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const categories = form.getAll("categories").map(String);
    const departments = form.getAll("departments").map(String);
    setBusy(true); setError("");
    const data = Object.fromEntries(["nom", "postnom", "prenom", "sexe", "date_naissance", "etat_civil", "telephone", "telephone_secondaire", "adresse", "commune", "quartier", "email", "frequentation_depuis", "date_debut_service", "fonction", "responsable_actuel", "observations"].map((key) => [key, String(form.get(key) ?? "")]));
    try {
      await apiFetch("/api/admin/members", { method: "POST", body: JSON.stringify({ ...data, categories, departments }) });
      setModal(false); setQuery(""); await load(0);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "La fiche n’a pas pu être créée."); }
    finally { setBusy(false); }
  }

  return <AdminShell title="Membres & ouvriers"><div className="admin-content">
    <div className="page-heading"><div><h1>Membres & ouvriers</h1><p>Une fiche individuelle unique, reliée à chaque département où la personne sert.</p></div><div className="page-actions"><button className="button" onClick={() => setModal(true)}><Plus size={16} /> Nouvelle fiche</button></div></div>
    {error && <div className="notice error" style={{ marginBottom: 15 }} role="alert">{error}</div>}
    <div className="card panel">
      <div className="filter-row"><div className="search-box"><Search size={16} /><input className="input" aria-label="Rechercher une personne" placeholder="Nom, prénom, identifiant ou téléphone…" value={query} onChange={(event) => setQuery(event.target.value)} /></div><span className="field-hint">{total.toLocaleString("fr-FR")} fiche(s)</span></div>
      {loading && !members.length ? <div className="empty-state"><div className="spinner" style={{ margin: "auto" }} /></div> : members.length ? <div className="table-wrap"><table><thead><tr><th>Personne</th><th>Identifiant</th><th>Téléphone</th><th>Catégories</th><th>Départements</th></tr></thead><tbody>{members.map((member) => <tr key={member.id}><td><div style={{ display: "flex", alignItems: "center", gap: 10 }}>{member.photo_url ? <img src={member.photo_url} alt="" style={{ width: 35, height: 35, borderRadius: "50%", objectFit: "cover" }} /> : <div className="avatar"><UserRound size={16} /></div>}<div><strong>{member.nom} {member.postnom} {member.prenom}</strong><div className="field-hint">{member.sexe} · {member.commune}</div></div></div></td><td><strong>{member.member_number}</strong></td><td>{member.telephone}</td><td><div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{member.categories.map((category) => <span className="badge active" key={category}>{categoryNames[category] ?? category}</span>)}</div></td><td>{member.departments.length ? member.departments.map((item) => item.name).join(" · ") : "—"}</td></tr>)}</tbody></table></div> : <div className="empty-state"><UserRound size={25} /><strong>{search ? "Aucun résultat" : "Aucune fiche disponible"}</strong>{search ? "Essayez un autre nom ou numéro." : "Les fiches apparaîtront ici après leur enregistrement ou validation."}</div>}
      {members.length < total && <div style={{ textAlign: "center", marginTop: 15 }}><button className="button secondary small" onClick={() => void load(page + 1)} disabled={loading}>{loading ? "Chargement…" : "Charger plus"} <ChevronDown size={15} /></button></div>}
    </div>
    {modal && <div role="presentation" onClick={() => setModal(false)} style={{ position: "fixed", inset: 0, zIndex: 50, background: "#172c2966", overflow: "auto", padding: 18, display: "grid", placeItems: "start center" }}><section role="dialog" aria-modal="true" aria-labelledby="create-title" className="card" onClick={(event) => event.stopPropagation()} style={{ width: "min(100%,760px)", margin: "20px auto", padding: 24 }}>
      <div className="panel-heading"><div><h2 id="create-title">Créer une fiche</h2><div className="field-hint">Les affectations de plusieurs départements partagent le même identifiant de membre.</div></div><button className="button secondary small" onClick={() => setModal(false)} aria-label="Fermer"><X size={16} /></button></div>
      <form onSubmit={(event) => void create(event)}>
        <div className="form-grid">
          {[["nom","Nom"],["postnom","Postnom"],["prenom","Prénom"],["telephone","Téléphone principal"],["adresse","Adresse"],["commune","Commune"],["telephone_secondaire","Téléphone secondaire"],["quartier","Quartier"],["email","Adresse électronique"],["date_naissance","Date de naissance"],["etat_civil","État civil"],["frequentation_depuis","Fréquente depuis"],["date_debut_service","Début du service"],["fonction","Fonction"],["responsable_actuel","Responsable actuel"]].map(([name, label]) => <div className="field" key={name}><label htmlFor={name}>{label}{["nom","postnom","prenom","telephone","adresse","commune"].includes(name) && <span className="required"> *</span>}</label><input id={name} name={name} required={["nom","postnom","prenom","telephone","adresse","commune"].includes(name)} type={name.startsWith("date_") ? "date" : name === "email" ? "email" : name.includes("telephone") ? "tel" : "text"} /></div>)}
          <div className="field span-2"><label htmlFor="sexe">Sexe *</label><select id="sexe" name="sexe" required><option value="">Sélectionner</option><option>Femme</option><option>Homme</option><option>Autre</option></select></div>
          <div className="field span-2"><label>Catégories *</label><div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>{Object.entries(categoryNames).map(([key, label]) => <label className="check-card" key={key} style={{ flex: "1 1 130px" }}><input type="checkbox" name="categories" value={key} defaultChecked={key === "member"} /><span>{label}</span></label>)}</div></div>
          <div className="field span-2"><label>Départements</label><div className="dept-grid">{departments.map((item) => <label className="check-card" key={item.id}><input type="checkbox" name="departments" value={item.id} /><span>{item.name}</span></label>)}</div><span className="field-hint">Les ouvriers doivent être affectés à au moins un département.</span></div>
          <div className="field span-2"><label htmlFor="observations">Observations</label><textarea id="observations" name="observations" maxLength={2000} /></div>
        </div>
        {error && <div className="notice error" style={{ margin: "14px 0" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 18 }}><button className="button secondary" type="button" onClick={() => setModal(false)}>Annuler</button><button className="button" type="submit" disabled={busy}>{busy ? "Enregistrement…" : "Créer la fiche"}</button></div>
      </form>
    </section></div>}
  </div></AdminShell>;
}

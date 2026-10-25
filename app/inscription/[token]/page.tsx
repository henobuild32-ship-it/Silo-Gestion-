"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { Camera, CheckCircle2, ChevronLeft, ChevronRight, Church, ImagePlus, LockKeyhole, Trash2, UserRound, UsersRound } from "lucide-react";
import { ChurchLogo } from "@/components/church-logo";

type Department = { id: string; name: string };
type Values = Record<string, string>;
const initialValues: Values = {
  nom: "", postnom: "", prenom: "", sexe: "", date_naissance: "", etat_civil: "", telephone: "", telephone_secondaire: "",
  adresse: "", commune: "", quartier: "", email: "", frequentation_depuis: "", date_debut_service: "", fonction: "", responsable_actuel: "", observations: "",
};

export default function WorkerRegistrationPage() {
  const { token } = useParams<{ token: string }>();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [values, setValues] = useState(initialValues);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [isCorrection, setIsCorrection] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const requestId = useRef("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/public/links/${encodeURIComponent(token)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setDepartments(data.departments ?? []);
        if (data.mode === "correction") {
          setIsCorrection(true);
          setValues({ ...initialValues, ...(data.data ?? {}) });
          setSelected(data.departmentIds ?? []);
        }
      })
      .catch((reason: Error) => { if (reason.name !== "AbortError") setError(reason.message || "Ce lien n’est pas disponible."); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [token]);

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);
  const departmentNames = useMemo(() => departments.filter((department) => selected.includes(department.id)).map((department) => department.name), [departments, selected]);

  function change(key: string, value: string) { setValues((current) => ({ ...current, [key]: value })); setError(""); }

  async function optimizeImage(file: File): Promise<File> {
    if (file.size <= 1024 * 1024 || typeof createImageBitmap === "undefined") return file;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d");
      if (!context) return file;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.84));
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, { type: "image/webp", lastModified: Date.now() });
    } catch { return file; }
  }

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/[.](jpe?g|png|webp)$/i.test(file.name) && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Utilisez une image JPEG, PNG ou WebP."); event.target.value = ""; return;
    }
    const optimized = await optimizeImage(file);
    if (optimized.size > 2 * 1024 * 1024) { setError("La photo doit peser 2 Mo maximum, même après compression."); event.target.value = ""; return; }
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhoto(optimized); setPhotoUrl(URL.createObjectURL(optimized)); setError("");
  }

  function advance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (!event.currentTarget.reportValidity()) return;
    if (step === 1 && selected.length === 0) { setError("Choisissez au moins un département."); return; }
    setStep((current) => current + 1);
  }

  async function submit() {
    if (!confirmed) { setError("Confirmez l’exactitude des informations."); return; }
    setBusy(true); setError("");
    const form = new FormData();
    Object.entries(values).forEach(([key, value]) => form.set(key, value));
    form.set("token", token);
    if (!requestId.current) requestId.current = crypto.randomUUID();
    form.set("requestId", requestId.current); form.set("exactitude_confirmee", "true"); form.set("website", "");
    selected.forEach((id) => form.append("departments", id));
    if (photo) form.set("photo", photo);
    try {
      const response = await fetch("/api/public/submissions", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "L’envoi du formulaire a échoué.");
      setReference(result.reference);
      setIsCorrection(Boolean(result.corrected));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "L’envoi du formulaire a échoué."); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="public-wrap"><div className="public-card" style={{ minHeight: 250, display: "grid", placeItems: "center" }}><div className="spinner" /></div></main>;
  return <main className="public-wrap">
    <Header />
    {error && departments.length === 0 ? <div className="public-card"><div className="public-card-body"><div className="notice error"><LockKeyhole size={17} />{error}</div><p style={{ margin: "18px 0 0", color: "var(--muted)", fontSize: 13 }}>Demandez un nouveau lien à l’administration du Centre Évangélique Silo.</p></div></div> : reference ? <Success reference={reference} correction={isCorrection} /> : <div className="public-card">
      <div className="public-card-head"><div className="eyebrow" style={{ marginBottom: 9 }}>Centre Évangélique Silo — Campus de la Cité Verte</div><h1 style={{ fontSize: 24, margin: "0 0 8px" }}>{isCorrection ? "CORRECTION DE VOTRE FICHE D’IDENTIFICATION" : "FORMULAIRE D’IDENTIFICATION DES OUVRIERS"}</h1><p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.65, margin: 0, maxWidth: 700 }}>{isCorrection ? "L’administration vous a demandé de compléter votre fiche. Les informations déjà transmises sont préremplies. Après votre envoi, le dossier retournera à l’administration pour une nouvelle vérification." : "Ce formulaire sert à mettre à jour les informations des ouvriers et à préparer leur affectation aux départements concernés. Les champs marqués d’un astérisque sont obligatoires."}</p></div>
      <div className="public-card-body">
        <div className="wizard-steps" aria-label={`Étape ${step + 1} sur 3`}>{[0, 1, 2].map((item) => <div key={item} className={`wizard-step ${item === step ? "current" : item < step ? "done" : ""}`} />)}</div>
        {error && <div className="notice error" role="alert" style={{ marginBottom: 15 }}>{error}</div>}
        {step === 0 && <form onSubmit={advance}>
          <section className="form-section"><SectionTitle icon={<UserRound size={17} />} title="Informations personnelles" description="Renseignez vos coordonnées pour permettre à l’administration de vous contacter." />
            <div className="form-grid">
              <Field label="Nom" required><input autoComplete="family-name" required maxLength={100} value={values.nom} onChange={(e) => change("nom", e.target.value)} /></Field>
              <Field label="Postnom" required><input required maxLength={100} value={values.postnom} onChange={(e) => change("postnom", e.target.value)} /></Field>
              <Field label="Prénom" required><input autoComplete="given-name" required maxLength={100} value={values.prenom} onChange={(e) => change("prenom", e.target.value)} /></Field>
              <Field label="Sexe" required><select required value={values.sexe} onChange={(e) => change("sexe", e.target.value)}><option value="">Sélectionner</option><option>Femme</option><option>Homme</option><option>Autre</option></select></Field>
              <Field label="Date de naissance"><input type="date" value={values.date_naissance} onChange={(e) => change("date_naissance", e.target.value)} /></Field>
              <Field label="État civil"><select value={values.etat_civil} onChange={(e) => change("etat_civil", e.target.value)}><option value="">Sélectionner (facultatif)</option><option>Célibataire</option><option>Marié(e)</option><option>Veuf/Veuve</option><option>Autre</option></select></Field>
              <Field label="Téléphone principal" required><input type="tel" autoComplete="tel" required maxLength={24} value={values.telephone} onChange={(e) => change("telephone", e.target.value)} placeholder="+243 …" /></Field>
              <Field label="Téléphone secondaire"><input type="tel" maxLength={24} value={values.telephone_secondaire} onChange={(e) => change("telephone_secondaire", e.target.value)} /></Field>
              <Field label="Adresse de résidence" required><input required maxLength={250} value={values.adresse} onChange={(e) => change("adresse", e.target.value)} /></Field>
              <Field label="Commune" required><input required maxLength={100} value={values.commune} onChange={(e) => change("commune", e.target.value)} /></Field>
              <Field label="Quartier"><input maxLength={100} value={values.quartier} onChange={(e) => change("quartier", e.target.value)} /></Field>
              <Field label="Adresse électronique"><input type="email" autoComplete="email" maxLength={254} value={values.email} onChange={(e) => change("email", e.target.value)} /></Field>
            </div>
          </section>
          <section className="form-section"><SectionTitle icon={<Camera />} title="Photo de profil" description={isCorrection ? "Vous pouvez remplacer la photo. Si vous n’en choisissez pas une nouvelle, la photo déjà transmise sera conservée." : "Veuillez ajouter une photo récente de type passeport afin de faciliter votre identification dans les dossiers de l’Église. Cette photo est facultative, mais recommandée."} />
            <div className="photo-drop">
              {photoUrl ? <img className="photo-preview" src={photoUrl} alt="Aperçu de la photo de profil" /> : <div className="photo-preview" style={{ display: "grid", placeItems: "center", color: "#8a9b90" }}><ImagePlus size={25} /></div>}
              <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 700, marginBottom: 5 }}>{photo ? photo.name : "Aucune photo sélectionnée"}</div><div className="field-hint" style={{ marginBottom: 10 }}>JPEG, PNG ou WebP · 2 Mo maximum</div><label className="button secondary small" style={{ display: "inline-flex", cursor: "pointer" }}><Camera size={14} /> {photo ? "Remplacer la photo" : "Ajouter une photo"}<input aria-label="Choisir une photo" type="file" accept="image/jpeg,image/png,image/webp" capture="user" onChange={(event) => void choosePhoto(event)} style={{ display: "none" }} /></label>{photo && <button type="button" className="button ghost small" style={{ marginLeft: 8 }} onClick={() => { URL.revokeObjectURL(photoUrl); setPhoto(null); setPhotoUrl(""); }}><Trash2 size={14} /> Supprimer</button>}</div>
            </div>
          </section>
          <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 18 }}><button className="button" type="submit">Continuer <ChevronRight size={16} /></button></div>
        </form>}
        {step === 1 && <form onSubmit={advance}>
          <section className="form-section"><SectionTitle icon={<Church size={17} />} title="Informations ecclésiastiques" description="Les dates inconnues ne bloquent pas l’envoi du formulaire." />
            <div className="form-grid">
              <Field label="Depuis quand fréquentez-vous le Centre Évangélique Silo ?"><input maxLength={100} value={values.frequentation_depuis} onChange={(e) => change("frequentation_depuis", e.target.value)} placeholder="Ex. 2018 ou environ 5 ans" /></Field>
              <Field label="Date de début du service"><input type="date" value={values.date_debut_service} onChange={(e) => change("date_debut_service", e.target.value)} /></Field>
              <Field label="Fonction actuelle dans l’Église"><input maxLength={150} value={values.fonction} onChange={(e) => change("fonction", e.target.value)} /></Field>
              <Field label="Nom du responsable actuel"><input maxLength={150} value={values.responsable_actuel} onChange={(e) => change("responsable_actuel", e.target.value)} /></Field>
              <Field label="Observations complémentaires"><textarea maxLength={2000} value={values.observations} onChange={(e) => change("observations", e.target.value)} /></Field>
            </div>
          </section>
          <section className="form-section"><SectionTitle icon={<UsersRound size={17} />} title="DÉPARTEMENTS DANS LESQUELS VOUS SERVEZ" description="Cochez tous les départements dans lesquels vous servez actuellement. Vous pouvez choisir un ou plusieurs départements." />
            <div className="dept-grid">{departments.map((department) => <label key={department.id} className={`check-card ${selected.includes(department.id) ? "selected" : ""}`}><input type="checkbox" checked={selected.includes(department.id)} onChange={() => setSelected((current) => current.includes(department.id) ? current.filter((item) => item !== department.id) : [...current, department.id])} /><span>{department.name}</span></label>)}</div>
            <div className="field-hint" style={{ marginTop: 10 }}>Départements sélectionnés : {departmentNames.length ? departmentNames.join(" · ") : "aucun"}</div>
          </section>
          <section className="form-section"><SectionTitle icon={<LockKeyhole size={17} />} title="Utilisation des informations" description="Ces données servent à la gestion administrative de l’Église. Elles sont consultées uniquement par les personnes autorisées dans le cadre de leurs fonctions." /><div className="notice"><LockKeyhole size={16} />Votre formulaire sera transmis à l’administration pour vérification. L’envoi ne valide pas automatiquement votre inscription.</div></section>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, paddingTop: 18 }}><button className="button secondary" type="button" onClick={() => setStep(0)}><ChevronLeft size={16} /> Précédent</button><button className="button" type="submit">Vérifier mes informations <ChevronRight size={16} /></button></div>
        </form>}
        {step === 2 && <>
          <section className="form-section"><SectionTitle icon={<CheckCircle2 size={17} />} title={isCorrection ? "Vérifiez les corrections" : "Vérifiez vos informations"} description="Vous pouvez revenir en arrière et corriger votre formulaire avant l’envoi." />
            <div className="summary-list">{[["Nom complet", `${values.nom} ${values.postnom} ${values.prenom}`], ["Téléphone", values.telephone], ["Adresse", `${values.adresse}, ${values.commune}${values.quartier ? ` · ${values.quartier}` : ""}`], ["Photo", photo ? photo.name : "Aucune photo"], ["Départements", departmentNames.join(" · ")], ["Service", [values.fonction, values.date_debut_service].filter(Boolean).join(" · ") || "Non renseigné"]].map(([label, value]) => <div className="summary-row" key={label}><strong>{label}</strong><span>{value}</span></div>)}</div>
            {photoUrl && <img src={photoUrl} alt="Photo sélectionnée" style={{ width: 70, height: 84, objectFit: "cover", borderRadius: 8, marginTop: 15 }} />}
          </section>
          <div className="notice" style={{ margin: "18px 0" }}><LockKeyhole size={16} />Vos informations ne sont visibles que par les personnes autorisées dans le cadre de leurs fonctions.</div>
          <label className="check-card" style={{ alignItems: "center", marginBottom: 18 }}><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span>Je confirme que les informations fournies sont exactes.</span></label>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><button className="button secondary" type="button" onClick={() => { setStep(1); setError(""); }} disabled={busy}><ChevronLeft size={16} /> Modifier le formulaire</button><button className="button" type="button" onClick={() => void submit()} disabled={busy}>{busy ? <><span className="spinner" /> Envoi…</> : <>{isCorrection ? "Envoyer mes corrections" : "Envoyer mon formulaire"} <ChevronRight size={16} /></>}</button></div>
        </>}
        <div className="field-hint" style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center", marginTop: 22 }}><LockKeyhole size={13} /> Connexion sécurisée · Aucun accès aux dossiers d’autres ouvriers</div>
      </div>
    </div>}
  </main>;
}

function Header() {
  return <header className="public-header"><ChurchLogo size={58} /><div><div className="brand-title">SILO VERT OUVRIERS</div><div className="brand-subtitle">Centre Évangélique Silo · Campus de la Cité Verte</div></div></header>;
}
function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return <div className="field"><label>{label}{required && <> <span className="required">*</span></>}</label>{children}</div>;
}
function SectionTitle({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <div className="section-title"><div className="section-title-icon">{icon}</div><div><h2>{title}</h2><p>{description}</p></div></div>;
}
function Success({ reference, correction }: { reference: string; correction: boolean }) {
  return <div className="public-card"><div className="public-card-body" style={{ textAlign: "center", padding: "54px 24px" }}><div style={{ display: "grid", placeItems: "center", margin: "0 auto 19px", width: 62, height: 62, borderRadius: "50%", background: "#e5f3e9", color: "#397052" }}><CheckCircle2 size={33} /></div><div className="eyebrow" style={{ justifyContent: "center" }}>Transmission terminée</div><h1 style={{ fontSize: 25, marginBottom: 12 }}>{correction ? "VOS CORRECTIONS ONT ÉTÉ ENVOYÉES" : "VOTRE FORMULAIRE A ÉTÉ ENVOYÉ AVEC SUCCÈS"}</h1><p style={{ maxWidth: 610, margin: "0 auto 18px", color: "var(--muted)", lineHeight: 1.7 }}>{correction ? "Merci. Vos corrections ont été transmises à l’administration du Centre Évangélique Silo — Campus de la Cité Verte. Un administrateur doit les vérifier et valider lui-même votre dossier avant son intégration aux départements." : "Merci d’avoir rempli votre fiche d’identification. Votre formulaire a été transmis à l’administration du Centre Évangélique Silo — Campus de la Cité Verte. Vos informations seront vérifiées avant la validation définitive de votre dossier."}</p><div className="card" style={{ display: "inline-block", padding: "12px 20px", margin: "4px auto 15px" }}><div className="field-hint">Numéro de référence</div><strong style={{ fontSize: 17, letterSpacing: ".07em" }}>{reference}</strong></div><div className="field-hint">L’envoi ne vaut pas validation. L’administration vous informera après vérification.</div></div></div>;
}

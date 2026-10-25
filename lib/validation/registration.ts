import { z } from "zod";

const dateValue = z.string().optional().or(z.literal(""));
const optionalText = z.string().trim().max(500).optional().or(z.literal(""));

export const registrationSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est obligatoire.").max(100),
  postnom: z.string().trim().min(1, "Le postnom est obligatoire.").max(100),
  prenom: z.string().trim().min(1, "Le prénom est obligatoire.").max(100),
  sexe: z.enum(["Femme", "Homme", "Autre"], { error: "Sélectionnez une option." }),
  date_naissance: dateValue,
  etat_civil: optionalText,
  telephone: z.string().trim().min(7, "Saisissez un numéro de téléphone valide.").max(24)
    .regex(/^[+0-9().\s-]+$/, "Format de téléphone invalide."),
  telephone_secondaire: z.string().trim().max(24).optional().or(z.literal("")),
  adresse: z.string().trim().min(1, "L’adresse est obligatoire.").max(250),
  commune: z.string().trim().min(1, "La commune est obligatoire.").max(100),
  quartier: z.string().trim().max(100).optional().or(z.literal("")),
  email: z.union([z.string().trim().email().max(254), z.literal(""), z.undefined()]),
  frequentation_depuis: z.string().trim().max(100).optional().or(z.literal("")),
  date_debut_service: dateValue,
  fonction: z.string().trim().max(150).optional().or(z.literal("")),
  responsable_actuel: z.string().trim().max(150).optional().or(z.literal("")),
  observations: z.string().trim().max(2000).optional().or(z.literal("")),
  departments: z.array(z.string().uuid()).min(1, "Choisissez au moins un département.").max(13),
  exactitude_confirmee: z.literal("true", { error: "Confirmez l’exactitude des informations." }),
});

export type RegistrationInput = z.infer<typeof registrationSchema>;

export const bootstrapSchema = z.object({
  setupKey: z.string().min(32).max(200),
  fullName: z.string().trim().min(2).max(140),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
});

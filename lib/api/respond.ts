import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Erreur API SILO", error instanceof Error ? error.message : "Erreur inconnue");
  return NextResponse.json({ error: "Une erreur est survenue. Réessayez plus tard." }, { status: 500 });
}

export function validationResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

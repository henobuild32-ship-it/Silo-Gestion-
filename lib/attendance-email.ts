import "server-only";
import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";

export function attendanceOtpConfigured() {
  const secret = process.env.ATTENDANCE_OTP_SECRET;
  return Boolean(
    process.env.SMTP_USER?.trim()
    && process.env.SMTP_APP_PASSWORD?.trim()
    && secret
    && Buffer.byteLength(secret) >= 32,
  );
}

export function hashAttendanceOtp(linkId: string, challengeId: string, attendanceId: string, code: string) {
  const secret = process.env.ATTENDANCE_OTP_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("Configuration OTP indisponible.");
  return createHmac("sha256", secret)
    .update(`${linkId}:${challengeId}:${attendanceId}:${code}`)
    .digest("hex");
}

export function distanceInMeters(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLatitude = radians(latitudeB - latitudeA);
  const deltaLongitude = radians(longitudeB - longitudeA);
  const value = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(deltaLongitude / 2) ** 2;
  return 6_371_008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, value))));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

export async function sendAttendanceOtp(email: string, code: string, eventName: string, eventDate: string) {
  const username = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_APP_PASSWORD?.replace(/\s/g, "");
  if (!username || !password || !attendanceOtpConfigured()) throw new Error("Configuration e-mail OTP indisponible.");

  const host = process.env.SMTP_HOST?.trim() || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port SMTP invalide.");
  const secure = port === 465;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user: username, pass: password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: "TLSv1.2" },
  });

  const safeEvent = escapeHtml(eventName);
  const dateLabel = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${eventDate}T12:00:00Z`));
  const safeDate = escapeHtml(dateLabel);
  try {
    await transporter.sendMail({
      from: { name: "Silo Vert Ouvriers", address: process.env.SMTP_FROM?.trim() || username },
      to: email,
      subject: "Code de confirmation de présence — Silo Vert Ouvriers",
      text: `Votre code de confirmation pour « ${eventName} » (${dateLabel}) est ${code}. Il expire dans 10 minutes. Ne partagez ce code avec personne. Si vous n'avez pas demandé ce code, ignorez ce message.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#17251d"><div style="padding:22px;background:#153c2b;color:#fff;border-radius:12px 12px 0 0"><strong>SILO VERT OUVRIERS</strong><div style="margin-top:8px;font-size:13px">Centre Évangélique Silo · Campus de la Cité Verte</div></div><div style="padding:24px;border:1px solid #e3e9e5;border-top:0;border-radius:0 0 12px 12px"><p>Code de confirmation pour <strong>${safeEvent}</strong>, le ${safeDate} :</p><div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f3f7f4;padding:16px;text-align:center;border-radius:8px">${code}</div><p>Ce code expire dans 10 minutes. Ne le partagez avec personne.</p><p style="font-size:12px;color:#65736b">Si vous n'avez pas demandé ce code, ignorez ce message.</p></div></div>`,
    });
  } finally {
    transporter.close();
  }
}


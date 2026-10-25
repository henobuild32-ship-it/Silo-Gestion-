import type { Metadata } from "next";
import "./globals.css";
import { PwaClient } from "@/components/pwa-client";

export const metadata: Metadata = {
  title: "SILO Gestion Église",
  description: "Gestion administrative du Centre Évangélique Silo — Campus de la Cité Verte.",
  applicationName: "SILO Gestion Église",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "SILO" },
  formatDetection: { telephone: false },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#173b32",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr">
      <body>{children}<PwaClient /></body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SILO Gestion Église",
  description: "Gestion administrative du Centre Évangélique Silo — Campus de la Cité Verte.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}

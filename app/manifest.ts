import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Silo Vert Ouvriers",
    short_name: "Silo Vert",
    description: "Gestion du Centre Évangélique Silo — Campus de la Cité Verte.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f5f7f4",
    theme_color: "#173b32",
    categories: ["business", "productivity"],
    icons: [
      { src: "/silo-logo.png", sizes: "474x474", type: "image/png", purpose: "any" },
    ],
  };
}

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cadence",
    short_name: "Cadence",
    description: "A real-time communication companion.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f5f7f4",
    theme_color: "#173d3a",
  };
}

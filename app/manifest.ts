import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sip — Water Reminder",
    short_name: "Sip",
    description: "Reminds you to drink water and tracks your glasses.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b1e33",
    theme_color: "#0b1e33",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

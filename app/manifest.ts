import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_DESCRIPTION } from "./lib/site";

// Web app manifest (served at /manifest.webmanifest, auto-linked by Next). Gives
// the site an installable identity + theme color for mobile browsers.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: "Profin",
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#87704d",
    icons: [{ src: "/icon.png", sizes: "any", type: "image/png" }],
  };
}

import { ImageResponse } from "next/og";
import { SITE_NAME } from "./lib/site";

// Site-wide social share image (og:image + twitter:image). Next auto-wires this
// file convention into the metadata with the correct absolute URL + dimensions,
// so every page that doesn't set its own image gets a branded card instead of a
// blank preview on LINE / Facebook / X / Slack. Text is English so it renders
// with ImageResponse's built-in font (Thai would need a bundled font file).
export const alt = `${SITE_NAME} — Testing Instruments & Laboratory Solutions`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #1c1917 0%, #2c2620 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            width: 120,
            height: 8,
            background: "#87704d",
            borderRadius: 4,
            marginBottom: 40,
          }}
        />
        <div style={{ fontSize: 86, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>
          {SITE_NAME}
        </div>
        <div style={{ fontSize: 42, color: "#a68d6a", marginTop: 24, fontWeight: 600 }}>
          Testing Instruments &amp; Laboratory Solutions
        </div>
        <div style={{ fontSize: 28, color: "#d6d3d1", marginTop: 32 }}>
          Sales · Repair · Calibration · Lab Construction — Nonthaburi, Thailand
        </div>
      </div>
    ),
    { ...size }
  );
}

// @ts-ignore bundled as text by the wrangler.toml rule
import css from "../public/app.css";
// @ts-ignore
import js from "../public/app.js";
// @ts-ignore
import icon from "../public/favicon.svg";

export const STATIC: Record<string, { body: string; type: string }> = {
  "/app.css": { body: css as string, type: "text/css; charset=utf-8" },
  "/app.js": { body: js as string, type: "text/javascript; charset=utf-8" },
  "/favicon.svg": { body: icon as string, type: "image/svg+xml" },
};

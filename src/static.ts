// @ts-ignore bundled as text by the wrangler.toml rule
import css from "../public/app.css";
// @ts-ignore
import js from "../public/app.js";
// @ts-ignore
import icon from "../public/favicon.svg";
// @ts-ignore bundled as binary (Data) by the wrangler.toml rule
import font from "../public/fonts/instrument-sans.woff2";
// @ts-ignore
import ogImage from "../public/og.jpg";
// @ts-ignore
import touchIcon from "../public/apple-touch-icon.png";
// Real screens of the app (preview fixtures with a public-domain draft), for the landing page.
// @ts-ignore
import calendar from "../public/shots/calendar.webp";
// @ts-ignore
import agenda from "../public/shots/agenda.webp";
// @ts-ignore
import stepQueue from "../public/shots/step-queue.webp";
// @ts-ignore
import stepDoc from "../public/shots/step-doc.webp";
// @ts-ignore
import stepPosts from "../public/shots/step-posts.webp";
// @ts-ignore
import post from "../public/shots/post.webp";
// @ts-ignore
import pubweek from "../public/shots/pubweek.webp";
// @ts-ignore
import placeholder from "../public/shots/placeholder.webp";

type File = { body: string | ArrayBuffer; type: string; immutable?: boolean };
const webp = (body: ArrayBuffer): File => ({ body, type: "image/webp", immutable: true });

export const STATIC: Record<string, File> = {
  "/app.css": { body: css as string, type: "text/css; charset=utf-8" },
  "/app.js": { body: js as string, type: "text/javascript; charset=utf-8" },
  "/favicon.svg": { body: icon as string, type: "image/svg+xml" },
  "/og.jpg": { body: ogImage as ArrayBuffer, type: "image/jpeg", immutable: true },
  "/apple-touch-icon.png": { body: touchIcon as ArrayBuffer, type: "image/png", immutable: true },
  "/fonts/instrument-sans.woff2": { body: font as ArrayBuffer, type: "font/woff2", immutable: true },
  "/shots/calendar.webp": webp(calendar),
  "/shots/agenda.webp": webp(agenda),
  "/shots/step-queue.webp": webp(stepQueue),
  "/shots/step-doc.webp": webp(stepDoc),
  "/shots/step-posts.webp": webp(stepPosts),
  "/shots/post.webp": webp(post),
  "/shots/pubweek.webp": webp(pubweek),
  "/shots/placeholder.webp": webp(placeholder),
};

import { readFileSync, existsSync, statSync } from "fs";
import { join, extname } from "path";

const DIST = join(import.meta.dir, "dist");
const indexHtml = readFileSync(join(DIST, "index.html"), "utf-8");

const ORIGIN = process.env.APP_URL || "https://index.network";

type RouteMeta = {
  title: string;
  description: string;
  image: string;
  type?: string;
};

const ROUTE_META: Record<string, RouteMeta> = {
  "/found-in-translation": {
    title: "Found in Translation | Index Network",
    description:
      "Some things find you. Most don't. That is, until language became our new interface and agents became our calling cards.",
    image: `${ORIGIN}/found-in-translation/found-in-translation-1-hero.png`,
    type: "article",
  },
};

function replaceMeta(html: string, attr: string, key: string, value: string): string {
  const re = new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`, "i");
  return html.replace(re, `$1${value}$2`);
}

function injectMeta(html: string, meta: RouteMeta, pathname: string): string {
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${meta.title}</title>`);
  html = replaceMeta(html, "name", "description", meta.description);
  html = replaceMeta(html, "property", "og:type", meta.type ?? "website");
  html = replaceMeta(html, "property", "og:url", `${ORIGIN}${pathname}`);
  html = replaceMeta(html, "property", "og:title", meta.title);
  html = replaceMeta(html, "property", "og:description", meta.description);
  html = replaceMeta(html, "property", "og:image", meta.image);
  html = replaceMeta(html, "name", "twitter:title", meta.title);
  html = replaceMeta(html, "name", "twitter:description", meta.description);
  html = replaceMeta(html, "name", "twitter:image", meta.image);
  return html;
}

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

const port = parseInt(process.env.PORT || "4173", 10);

Bun.serve({
  port,
  hostname: "0.0.0.0",
  fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    const filePath = join(DIST, pathname);
    if (
      pathname !== "/" &&
      existsSync(filePath) &&
      statSync(filePath).isFile()
    ) {
      return new Response(Bun.file(filePath), {
        headers: {
          "Content-Type": MIME[extname(pathname)] || "application/octet-stream",
        },
      });
    }

    const meta = ROUTE_META[pathname];
    const html = meta ? injectMeta(indexHtml, meta, pathname) : indexHtml;
    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
  },
});

console.log(`Frontend server listening on :${port}`);

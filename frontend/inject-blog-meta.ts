/**
 * Post-build script: generates per-route index.html files with correct
 * OG / Twitter meta tags so social-media crawlers see the right previews.
 *
 * Covers marketing pages (hardcoded) and blog posts (from posts.json).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const DIST_DIR = join(import.meta.dir, "dist");
const TEMPLATE_HTML = join(DIST_DIR, "index.html");
const POSTS_JSON = join(DIST_DIR, "blog", "posts.json");

const SITE_URL = "https://index.network";
const DEFAULT_IMAGE = `${SITE_URL}/link-preview.png`;

const template = readFileSync(TEMPLATE_HTML, "utf-8");

interface PageMeta {
  path: string;
  title: string;
  description: string;
  image: string;
  type?: string;
}

// ── Marketing pages ─────────────────────────────────────────────
const MARKETING_PAGES: PageMeta[] = [
  {
    path: "/found-in-translation",
    title: "Found in Translation | Index Network",
    description:
      "Some things find you. Most don't. That is, until language became our new interface and agents became our calling cards.",
    image: `${SITE_URL}/found-in-translation/found-in-translation-1-hero.png`,
    type: "article",
  },
];

// ── Blog posts ──────────────────────────────────────────────────
function loadBlogPages(): PageMeta[] {
  if (!existsSync(POSTS_JSON)) return [];

  const posts: { slug: string; title: string; description?: string; image?: string }[] =
    JSON.parse(readFileSync(POSTS_JSON, "utf-8"));

  return posts.map((p) => ({
    path: `/blog/${p.slug}`,
    title: `${p.title} — Index Network`,
    description: p.description || "",
    image: p.image ? `${SITE_URL}${p.image}` : DEFAULT_IMAGE,
    type: "article",
  }));
}

// ── HTML rewriting ──────────────────────────────────────────────
function replaceMeta(html: string, attr: string, key: string, value: string): string {
  return html.replace(
    new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`,"i"),
    `$1${value}$2`,
  );
}

function buildHtml(meta: PageMeta): string {
  let html = template.replace(/<title>[^<]*<\/title>/, `<title>${meta.title}</title>`);
  html = replaceMeta(html, "name", "description", meta.description);
  html = replaceMeta(html, "property", "og:type", meta.type ?? "website");
  html = replaceMeta(html, "property", "og:url", `${SITE_URL}${meta.path}`);
  html = replaceMeta(html, "property", "og:title", meta.title);
  html = replaceMeta(html, "property", "og:description", meta.description);
  html = replaceMeta(html, "property", "og:image", meta.image);
  html = replaceMeta(html, "name", "twitter:title", meta.title);
  html = replaceMeta(html, "name", "twitter:description", meta.description);
  html = replaceMeta(html, "name", "twitter:image", meta.image);
  return html;
}

// ── Run ─────────────────────────────────────────────────────────
const pages = [...MARKETING_PAGES, ...loadBlogPages()];

for (const page of pages) {
  const dir = join(DIST_DIR, page.path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), buildHtml(page));
}

console.log(`Injected meta tags for ${pages.length} pages`);

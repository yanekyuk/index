import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const DIST_DIR = join(import.meta.dir, "dist");
const POSTS_JSON = join(DIST_DIR, "blog", "posts.json");
const TEMPLATE_HTML = join(DIST_DIR, "index.html");

if (!existsSync(POSTS_JSON)) {
  console.log("No posts.json found, skipping blog meta injection");
  process.exit(0);
}

const posts: Array<{
  slug: string;
  title: string;
  description?: string;
  image?: string;
}> = JSON.parse(readFileSync(POSTS_JSON, "utf-8"));

const template = readFileSync(TEMPLATE_HTML, "utf-8");

const SITE_URL = "https://index.network";
const DEFAULT_TITLE = "Index Network";
const DEFAULT_DESCRIPTION =
  "You know that moment when the right person unlocks your next move? Index makes that magic repeatable, and helps your others find you.";
const DEFAULT_IMAGE = `${SITE_URL}/link-preview.png`;

let injected = 0;

for (const post of posts) {
  const postTitle = `${post.title} — Index Network`;
  const postDescription = post.description || DEFAULT_DESCRIPTION;
  const postImage = post.image
    ? `${SITE_URL}${post.image}`
    : DEFAULT_IMAGE;
  const postUrl = `${SITE_URL}/blog/${post.slug}`;

  let html = template;

  // Replace <title>
  html = html.replace(
    `<title>${DEFAULT_TITLE}</title>`,
    `<title>${postTitle}</title>`,
  );

  // Replace og tags
  html = html.replace(
    `<meta property="og:title" content="${DEFAULT_TITLE}" />`,
    `<meta property="og:title" content="${post.title}" />`,
  );
  html = html.replace(
    `<meta property="og:description" content="${DEFAULT_DESCRIPTION}" />`,
    `<meta property="og:description" content="${postDescription}" />`,
  );
  html = html.replace(
    `<meta property="og:image" content="${DEFAULT_IMAGE}" />`,
    `<meta property="og:image" content="${postImage}" />`,
  );
  html = html.replace(
    `<meta property="og:url" content="${SITE_URL}/" />`,
    `<meta property="og:url" content="${postUrl}" />`,
  );

  // Replace twitter tags
  html = html.replace(
    `<meta name="twitter:title" content="${DEFAULT_TITLE}" />`,
    `<meta name="twitter:title" content="${post.title}" />`,
  );
  html = html.replace(
    `<meta name="twitter:description" content="${DEFAULT_DESCRIPTION}" />`,
    `<meta name="twitter:description" content="${postDescription}" />`,
  );
  html = html.replace(
    `<meta name="twitter:image" content="${DEFAULT_IMAGE}" />`,
    `<meta name="twitter:image" content="${postImage}" />`,
  );

  // Replace meta description
  html = html.replace(
    `<meta name="description" content="${DEFAULT_DESCRIPTION}" />`,
    `<meta name="description" content="${postDescription}" />`,
  );

  const outDir = join(DIST_DIR, "blog", post.slug);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "index.html"), html);
  injected++;
}

console.log(`Injected meta tags for ${injected} blog posts`);

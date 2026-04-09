/**
 * Static file server replacing `vite preview`.
 * Resolves /foo to /foo/index.html (directory indexing)
 * so crawlers see the per-route meta tags generated at build time.
 */
import { existsSync, statSync } from "fs";
import { join } from "path";

const DIST = join(import.meta.dir, "dist");
const fallback = Bun.file(join(DIST, "index.html"));
const port = parseInt(process.env.PORT || "4173", 10);

Bun.serve({
  port,
  hostname: "0.0.0.0",
  async fetch(req) {
    const pathname = new URL(req.url).pathname;

    for (const p of [join(DIST, pathname), join(DIST, pathname, "index.html")]) {
      if (existsSync(p) && statSync(p).isFile()) return new Response(Bun.file(p));
    }

    return new Response(fallback);
  },
});

console.log(`Listening on :${port}`);

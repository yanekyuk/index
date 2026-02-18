import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const dir = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(dir, ".env.local") });
config({ path: path.join(dir, ".env") });

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

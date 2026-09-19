import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // db push / migrate ont besoin d'une connexion directe (port 5432),
    // pas du pooler PgBouncer en mode transaction (port 6543) qui bloque le schema-engine.
    url: process.env["DIRECT_URL"]!,
  },
});

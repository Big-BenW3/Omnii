import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config(); 

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in your environment variables");
}

export default defineConfig({
  schema: "./apps/web/app/lib/db/schema.ts",
  out: "./apps/web/app/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});

import { existsSync } from "node:fs";

if (existsSync(".env.local")) {
  console.error("This project is configured to use .env only. Remove .env.local before running scripts.");
  process.exit(1);
}

import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";

// Expect `DATABASE_URL` to be provided in the environment. This keeps configuration
// simple and avoids maintaining two different DB config styles.
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "info", "warn", "error"] : ["warn", "error"]
});

export default prisma;

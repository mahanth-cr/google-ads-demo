/**
 * Simple token store for the demo.
 * In production this maps to SecretService (Azure Key Vault / .env).
 * Here we use a module-level Map (survives Next.js hot-reload in dev
 * as long as the process doesn't restart) plus optional .env.local persistence.
 */

import fs from "fs";
import path from "path";

const store = new Map<string, string>();

export function setToken(key: string, value: string): void {
  store.set(key, value);
  process.env[key] = value;

  // Persist to .env.local so tokens survive `next dev` restarts
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    let content = fs.readFileSync(envPath, "utf-8");
    const regex = new RegExp(`^${key}=.*$`, "m");
    content = regex.test(content)
      ? content.replace(regex, `${key}=${value}`)
      : content + `\n${key}=${value}`;
    fs.writeFileSync(envPath, content);
  }
}

export function getToken(key: string): string | null {
  return store.get(key) ?? process.env[key] ?? null;
}

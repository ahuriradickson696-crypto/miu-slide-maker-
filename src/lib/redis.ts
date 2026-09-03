import { Redis } from "@upstash/redis";

// Lazy singleton, mirroring the pattern in db.ts. Reads
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN from the environment —
// never hardcode these. Set them in Vercel's Environment Variables (or
// .env locally), same as DATABASE_URL and GROQ_API_KEY.
let client: Redis | null | undefined;

export function redis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

export function redisConfigured(): boolean {
  return !!(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

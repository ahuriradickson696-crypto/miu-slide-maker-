import { getConfigStatus } from "./config-status";

type ServiceCheck = {
  configured: boolean;
  ok: boolean | null; // null = not configured, so not checked
  error?: string;
};

export type HealthReport = {
  status: "ok" | "degraded" | "down";
  time: string;
  database: ServiceCheck;
  redis: ServiceCheck;
};

// Bounded so a slow/hanging DB or Redis can't make the health check itself
// hang forever — an uptime monitor should get an answer quickly either way.
const CHECK_TIMEOUT_MS = 4000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function checkDatabase(): Promise<ServiceCheck> {
  const configured = getConfigStatus().database;
  if (!configured) return { configured: false, ok: null };
  try {
    const { sql } = await import("./db");
    await withTimeout(sql()`SELECT 1`, CHECK_TIMEOUT_MS);
    return { configured: true, ok: true };
  } catch (err) {
    return { configured: true, ok: false, error: err instanceof Error ? err.message : "unknown error" };
  }
}

async function checkRedis(): Promise<ServiceCheck> {
  const configured = getConfigStatus().redis;
  if (!configured) return { configured: false, ok: null };
  try {
    const { redis } = await import("./redis");
    const client = redis();
    if (!client) return { configured: true, ok: false, error: "client unavailable" };
    await withTimeout(client.ping(), CHECK_TIMEOUT_MS);
    return { configured: true, ok: true };
  } catch (err) {
    return { configured: true, ok: false, error: err instanceof Error ? err.message : "unknown error" };
  }
}

export async function runHealthCheck(): Promise<HealthReport> {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);

  const databaseDown = database.configured && database.ok === false;
  const redisDown = redis.configured && redis.ok === false;

  // DB failing is more severe (History breaks); Redis failing just drops
  // back to best-effort single-instance behavior, so it's "degraded" not "down".
  const status: HealthReport["status"] = databaseDown ? "down" : redisDown ? "degraded" : "ok";

  return { status, time: new Date().toISOString(), database, redis };
}

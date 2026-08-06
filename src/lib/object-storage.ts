import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 and Backblaze B2 (and most other object storage providers)
// speak the S3 API, so one client implementation covers both — they're
// distinguished only by which env vars are set and which bucket/endpoint
// gets passed in. Real S3-compatible auth needs an access key ID AND a
// secret access key (a single "API key" isn't enough) — see the readiness
// checks below for exactly which vars each target needs.

export type StorageTarget = "r2" | "backup";

function readTargetConfig(target: StorageTarget): {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
} | null {
  if (target === "r2") {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    const bucket = process.env.CLOUDFLARE_R2_BUCKET;
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
    return {
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      region: "auto",
      accessKeyId,
      secretAccessKey,
      bucket,
    };
  }

  // target === "backup" — a generic S3-compatible target (Backblaze B2,
  // AWS S3, MinIO, etc.), configured by its full endpoint hostname.
  const endpointHost = process.env.BACKUP_STORAGE_ENDPOINT;
  const accessKeyId = process.env.BACKUP_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BACKUP_STORAGE_SECRET_ACCESS_KEY;
  const bucket = process.env.BACKUP_STORAGE_BUCKET;
  if (!endpointHost || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    endpoint: endpointHost.startsWith("http") ? endpointHost : `https://${endpointHost}`,
    region: process.env.BACKUP_STORAGE_REGION || "us-east-1",
    accessKeyId,
    secretAccessKey,
    bucket,
  };
}

export function storageConfigured(target: StorageTarget): boolean {
  return readTargetConfig(target) !== null;
}

function getClient(target: StorageTarget): { client: S3Client; bucket: string } {
  const config = readTargetConfig(target);
  if (!config) throw new Error(`${target === "r2" ? "R2" : "Backup"} storage isn't configured.`);
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return { client, bucket: config.bucket };
}

export async function uploadObject(
  target: StorageTarget,
  key: string,
  body: Buffer | string,
  contentType: string,
): Promise<void> {
  const { client, bucket } = getClient(target);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

// A time-limited download link — safer than making the bucket public,
// works for both R2 and any generic S3-compatible backup target.
export async function getDownloadUrl(target: StorageTarget, key: string, expiresInSeconds = 3600): Promise<string> {
  const { client, bucket } = getClient(target);
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

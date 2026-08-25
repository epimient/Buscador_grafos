import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config';

/**
 * The endpoint must be the *region* host (sfo3.digitaloceanspaces.com), NOT the
 * bucket-prefixed host. The SDK prepends the bucket as a subdomain when
 * forcePathStyle is false, so a bucket-prefixed endpoint produces URLs like
 * `n8ns3.n8ns3.sfo3...`. Strip the bucket prefix if someone configured it that way.
 */
function normalizeEndpoint(endpoint: string, bucket: string): string {
  if (!endpoint || !bucket) return endpoint;
  try {
    const u = new URL(endpoint);
    const prefix = `${bucket}.`;
    if (u.hostname.startsWith(prefix)) {
      u.hostname = u.hostname.slice(prefix.length);
      console.warn(
        `[s3] stripped bucket prefix from S3_ENDPOINT — using ${u.toString()}`,
      );
      return u.toString().replace(/\/$/, '');
    }
    return endpoint;
  } catch {
    return endpoint;
  }
}

const normalizedEndpoint = normalizeEndpoint(config.s3.endpoint, config.s3.bucket);

export const s3 = new S3Client({
  endpoint: normalizedEndpoint,
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKey,
    secretAccessKey: config.s3.secretKey,
  },
  forcePathStyle: false,
});

export async function presignDownload(key: string, expiresInSeconds = 60, filename?: string): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    ResponseContentDisposition: filename
      ? `attachment; filename="${filename.replace(/"/g, '')}"`
      : 'attachment',
  });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });
}

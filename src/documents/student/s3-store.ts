/**
 * The S3 side of direct uploads. Credentials come from the default AWS chain: in production the
 * pod's IRSA role (hb-prod-apse2-expert-ai-consultant), which may put, get and delete only under
 * the bucket's upload prefix.
 */
import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import type { PresignedPost, UploadObjectStore } from "./direct-upload";

export function s3UploadStore(opts: { bucket: string; region: string; client?: S3Client }): UploadObjectStore {
  const client = opts.client ?? new S3Client({ region: opts.region });
  return {
    async presignPost(key, { mimeType, maxBytes, expiresSeconds }): Promise<PresignedPost> {
      const { url, fields } = await createPresignedPost(client, {
        Bucket: opts.bucket,
        Key: key,
        Expires: expiresSeconds,
        Fields: { "Content-Type": mimeType },
        // S3 refuses anything bigger than the limit or of another declared type.
        Conditions: [
          ["content-length-range", 1, maxBytes],
          ["eq", "$Content-Type", mimeType],
        ],
      });
      return { url, fields };
    },

    async get(key, maxBytes) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: opts.bucket, Key: key }));
        if ((res.ContentLength ?? 0) > maxBytes) throw new Error(`object ${key} is larger than ${maxBytes} bytes`);
        const bytes = await res.Body?.transformToByteArray();
        return bytes ?? null;
      } catch (err) {
        const name = (err as { name?: string }).name;
        if (name === "NoSuchKey" || name === "NotFound") return null;
        throw err;
      }
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: key }));
    },
  };
}

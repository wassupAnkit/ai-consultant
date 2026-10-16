import { describe, expect, test } from "bun:test";
import { S3Client } from "@aws-sdk/client-s3";
import { s3UploadStore } from "../src/documents/student/s3-store";

describe("s3UploadStore.presignPost", () => {
  test("S3 itself enforces the size limit and the declared type (offline, dummy credentials)", async () => {
    const client = new S3Client({ region: "ap-southeast-2", credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret" } });
    const store = s3UploadStore({ bucket: "edge-docs-test", region: "ap-southeast-2", client });
    const { url, fields } = await store.presignPost("incoming/abc", { mimeType: "image/png", maxBytes: 10_485_760, expiresSeconds: 600 });

    expect(url).toContain("edge-docs-test");
    expect(url).toContain("ap-southeast-2");
    expect(fields.key).toBe("incoming/abc");
    expect(fields["Content-Type"]).toBe("image/png");
    const policy = JSON.parse(Buffer.from(fields.Policy!, "base64").toString("utf8")) as { expiration: string; conditions: unknown[] };
    expect(policy.conditions).toContainEqual(["content-length-range", 1, 10_485_760]);
    expect(policy.conditions).toContainEqual(["eq", "$Content-Type", "image/png"]);
    expect(policy.conditions).toContainEqual({ key: "incoming/abc" });
    expect(new Date(policy.expiration).getTime() - Date.now()).toBeLessThanOrEqual(600_000 + 5_000);
  });
});

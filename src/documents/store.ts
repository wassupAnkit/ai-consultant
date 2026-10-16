import { GridFSBucket, type Db } from "mongodb";

/**
 * Raw bytes of staff-uploaded documents. GridFS keeps everything in MongoDB
 * Atlas (no new infrastructure); the interface lets `Bun.s3` replace it later
 * without touching callers.
 */
export interface FileStore {
  put(id: string, data: Uint8Array, meta: { filename: string; mimeType: string }): Promise<void>;
  get(id: string): Promise<Uint8Array | null>;
  delete(id: string): Promise<void>;
}

export class InMemoryFileStore implements FileStore {
  readonly files = new Map<string, { data: Uint8Array; filename: string; mimeType: string }>();
  async put(id: string, data: Uint8Array, meta: { filename: string; mimeType: string }) {
    this.files.set(id, { data, ...meta });
  }
  async get(id: string) {
    return this.files.get(id)?.data ?? null;
  }
  async delete(id: string) {
    this.files.delete(id);
  }
}

/** GridFS bucket `kb_files`; the document id is used as the GridFS filename so lookups need no ObjectId mapping. */
export class GridFsFileStore implements FileStore {
  private readonly bucket: GridFSBucket;
  constructor(db: Db, bucketName = "kb_files") {
    this.bucket = new GridFSBucket(db, { bucketName });
  }

  async put(id: string, data: Uint8Array, meta: { filename: string; mimeType: string }) {
    await this.delete(id);
    await new Promise<void>((resolve, reject) => {
      const stream = this.bucket.openUploadStream(id, { metadata: { originalName: meta.filename, mimeType: meta.mimeType }, contentType: meta.mimeType });
      stream.once("error", reject);
      stream.once("finish", () => resolve());
      stream.end(Buffer.from(data));
    });
  }

  async get(id: string) {
    const files = await this.bucket.find({ filename: id }).limit(1).toArray();
    if (!files.length) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of this.bucket.openDownloadStream(files[0]!._id)) chunks.push(chunk as Buffer);
    return new Uint8Array(Buffer.concat(chunks));
  }

  async delete(id: string) {
    const files = await this.bucket.find({ filename: id }).toArray();
    for (const f of files) await this.bucket.delete(f._id).catch(() => undefined);
  }
}

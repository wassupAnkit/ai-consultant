/**
 * Stored Google grants, one per consultant, in `google_connections` (`_id` = lower-cased actor
 * email). The refresh token is only ever kept as an `EncryptedBlob`.
 *
 * Re-connecting (to add Drive to Gmail, or after `reauth_required`) upserts the same row. Google
 * sometimes omits `refresh_token` on a repeat consent; then the stored token is still the live one
 * for the same Google account, so it is kept. That only holds while the stored grant is healthy:
 * without a new token, a `reauth_required` row (dead token) or a different Google account cannot be
 * upserted and `upsert` returns null.
 *
 * `grantedScopes` is always replaced, never merged: the caller computes the list the consultant
 * enabled (Google's `include_granted_scopes` echoes scopes they disconnected here, which must not
 * come back on their own).
 */
import type { Collection } from "mongodb";
import type { EncryptedBlob, GoogleConnection } from "./types";

export const GOOGLE_CONNECTIONS_COLLECTION = "google_connections";

export interface GoogleConnectionUpsert {
  actor: string;
  googleSub: string;
  googleEmail: string;
  /** The full list to store (replaces what is there). */
  grantedScopes: string[];
  /** Absent when Google returned no refresh token for this grant. */
  refreshTokenEnc?: EncryptedBlob;
}

export interface GoogleConnectionStore {
  get(actor: string): Promise<GoogleConnection | null>;
  /** Store a fresh grant. Returns null when there is no refresh token to keep (see file comment). */
  upsert(conn: GoogleConnectionUpsert): Promise<GoogleConnection | null>;
  /**
   * Google refused the refresh token: the consultant must connect again. Only applies while the row
   * still holds that token (`refreshTokenCt` = its `refreshTokenEnc.ct`), so a refresh that started
   * before a reconnect cannot mark the new grant. True when the row was marked.
   */
  markReauth(actor: string, refreshTokenCt: string): Promise<boolean>;
  /** Replace the granted scopes (disconnecting one service); null when there is no row. */
  setScopes(actor: string, scopes: string[]): Promise<GoogleConnection | null>;
  delete(actor: string): Promise<boolean>;
  touch(actor: string, at?: Date): Promise<void>;
}

export type GoogleConnectionDoc = GoogleConnection & { _id: string };

export const actorKey = (actor: string) => actor.trim().toLowerCase();

const fromDoc = (doc: GoogleConnectionDoc | null): GoogleConnection | null => {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
};

export class MongoGoogleConnectionStore implements GoogleConnectionStore {
  constructor(
    private readonly collection: Collection<GoogleConnectionDoc>,
    private readonly now: () => number = Date.now,
  ) {}

  async get(actor: string): Promise<GoogleConnection | null> {
    return fromDoc(await this.collection.findOne({ _id: actorKey(actor) }));
  }

  // mongodb@6: without includeResultMetadata, findOneAndUpdate resolves to the document or null.
  async upsert(c: GoogleConnectionUpsert): Promise<GoogleConnection | null> {
    const _id = actorKey(c.actor);
    const at = new Date(this.now());
    if (c.refreshTokenEnc) {
      return fromDoc(
        await this.collection.findOneAndUpdate(
          { _id },
          {
            $set: {
              actor: _id,
              googleSub: c.googleSub,
              googleEmail: c.googleEmail.toLowerCase(),
              grantedScopes: [...new Set(c.grantedScopes)],
              refreshTokenEnc: c.refreshTokenEnc,
              status: "connected",
              connectedAt: at,
              updatedAt: at,
            },
          },
          { upsert: true, returnDocument: "after" },
        ),
      );
    }
    // No new token: only a healthy grant of the same Google account can take the new scopes.
    return fromDoc(
      await this.collection.findOneAndUpdate(
        { _id, status: "connected", googleSub: c.googleSub },
        { $set: { grantedScopes: [...new Set(c.grantedScopes)], googleEmail: c.googleEmail.toLowerCase(), updatedAt: at } },
        { returnDocument: "after" },
      ),
    );
  }

  async markReauth(actor: string, refreshTokenCt: string): Promise<boolean> {
    const r = await this.collection.updateOne(
      { _id: actorKey(actor), "refreshTokenEnc.ct": refreshTokenCt },
      { $set: { status: "reauth_required", updatedAt: new Date(this.now()) } },
    );
    return r.matchedCount > 0;
  }

  async setScopes(actor: string, scopes: string[]): Promise<GoogleConnection | null> {
    return fromDoc(
      await this.collection.findOneAndUpdate(
        { _id: actorKey(actor) },
        { $set: { grantedScopes: [...new Set(scopes)], updatedAt: new Date(this.now()) } },
        { returnDocument: "after" },
      ),
    );
  }

  async delete(actor: string): Promise<boolean> {
    return (await this.collection.deleteOne({ _id: actorKey(actor) })).deletedCount > 0;
  }

  async touch(actor: string, at: Date = new Date(this.now())): Promise<void> {
    await this.collection.updateOne({ _id: actorKey(actor) }, { $set: { lastUsedAt: at } });
  }
}

/** Map-backed store for tests and Mongo-less runs. Copies in and out, like a real database. */
export class InMemoryGoogleConnectionStore implements GoogleConnectionStore {
  private readonly rows = new Map<string, GoogleConnection>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(actor: string): Promise<GoogleConnection | null> {
    const row = this.rows.get(actorKey(actor));
    return row ? structuredClone(row) : null;
  }

  async upsert(c: GoogleConnectionUpsert): Promise<GoogleConnection | null> {
    const key = actorKey(c.actor);
    const at = new Date(this.now());
    const prev = this.rows.get(key);
    let next: GoogleConnection;
    if (c.refreshTokenEnc) {
      next = {
        ...(prev?.lastUsedAt ? { lastUsedAt: prev.lastUsedAt } : {}),
        actor: key,
        googleSub: c.googleSub,
        googleEmail: c.googleEmail.toLowerCase(),
        grantedScopes: [...new Set(c.grantedScopes)],
        refreshTokenEnc: structuredClone(c.refreshTokenEnc),
        status: "connected",
        connectedAt: at,
        updatedAt: at,
      };
    } else {
      if (!prev || prev.status !== "connected" || prev.googleSub !== c.googleSub) return null;
      next = { ...prev, googleEmail: c.googleEmail.toLowerCase(), grantedScopes: [...new Set(c.grantedScopes)], updatedAt: at };
    }
    this.rows.set(key, next);
    return structuredClone(next);
  }

  async markReauth(actor: string, refreshTokenCt: string): Promise<boolean> {
    const row = this.rows.get(actorKey(actor));
    if (!row || row.refreshTokenEnc.ct !== refreshTokenCt) return false;
    this.rows.set(actorKey(actor), { ...row, status: "reauth_required", updatedAt: new Date(this.now()) });
    return true;
  }

  async setScopes(actor: string, scopes: string[]): Promise<GoogleConnection | null> {
    const row = this.rows.get(actorKey(actor));
    if (!row) return null;
    const next = { ...row, grantedScopes: [...new Set(scopes)], updatedAt: new Date(this.now()) };
    this.rows.set(actorKey(actor), next);
    return structuredClone(next);
  }

  async delete(actor: string): Promise<boolean> {
    return this.rows.delete(actorKey(actor));
  }

  async touch(actor: string, at: Date = new Date(this.now())): Promise<void> {
    const row = this.rows.get(actorKey(actor));
    if (row) this.rows.set(actorKey(actor), { ...row, lastUsedAt: at });
  }
}

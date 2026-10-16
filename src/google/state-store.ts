/**
 * One-time OAuth `state` values for the Google connect flow, in `google_oauth_states`.
 *
 * The state is 256 bits of randomness handed to Google and back. Only its sha256 is stored (as
 * `_id`), next to the consultant it was issued to, the services asked for, the PKCE verifier and
 * where to send them afterwards. It lives 10 minutes (TTL index) and is consumed exactly once:
 * `findOneAndDelete` makes a replayed or raced callback find nothing.
 */
import type { Collection, Db } from "mongodb";
import { b64urlEncode } from "../auth/supabase";
import type { WorkspaceService } from "./types";

export const GOOGLE_OAUTH_STATES_COLLECTION = "google_oauth_states";
export const OAUTH_STATE_TTL_MS = 10 * 60_000;

export interface OAuthStateInput {
  actor: string;
  services: WorkspaceService[];
  codeVerifier: string;
  returnTo: string;
}

export interface OAuthStateRecord extends OAuthStateInput {
  createdAt: Date;
  expiresAt: Date;
}

export interface OAuthStateStore {
  /** Store a new state for this consultant; returns the raw state to put in the consent URL. */
  create(rec: OAuthStateInput): Promise<string>;
  /** Atomically take the state: null when unknown, already used, or expired. */
  consume(state: string): Promise<OAuthStateRecord | null>;
}

export type OAuthStateDoc = OAuthStateRecord & { _id: string };

export const newOAuthState = (): string => b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));

export function hashState(state: string): string {
  return new Bun.CryptoHasher("sha256").update(state).digest("hex");
}

const fromDoc = (doc: OAuthStateDoc | null): OAuthStateRecord | null => {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
};

/** Anything that is not a plausible base64url state is rejected before touching the store. */
const plausible = (state: string) => typeof state === "string" && /^[\w-]{16,256}$/.test(state);

export class MongoOAuthStateStore implements OAuthStateStore {
  constructor(
    private readonly collection: Collection<OAuthStateDoc>,
    private readonly now: () => number = Date.now,
  ) {}

  async create(rec: OAuthStateInput): Promise<string> {
    const state = newOAuthState();
    const at = this.now();
    await this.collection.insertOne({
      _id: hashState(state),
      actor: rec.actor.trim().toLowerCase(),
      services: [...rec.services],
      codeVerifier: rec.codeVerifier,
      returnTo: rec.returnTo,
      createdAt: new Date(at),
      expiresAt: new Date(at + OAUTH_STATE_TTL_MS),
    });
    return state;
  }

  // mongodb@6: without includeResultMetadata, findOneAndDelete resolves to the document or null.
  // An expired state is taken too (the TTL monitor runs only once a minute) but reported as null.
  async consume(state: string): Promise<OAuthStateRecord | null> {
    if (!plausible(state)) return null;
    const rec = fromDoc(await this.collection.findOneAndDelete({ _id: hashState(state) }));
    return rec && rec.expiresAt.getTime() > this.now() ? rec : null;
  }
}

/** TTL on `expiresAt`: Mongo drops an unused state once it has expired. */
export async function ensureGoogleOAuthStateIndexes(db: Db): Promise<void> {
  await db.collection<OAuthStateDoc>(GOOGLE_OAUTH_STATES_COLLECTION).createIndexes([{ key: { expiresAt: 1 }, expireAfterSeconds: 0 }]);
}

/** Map-backed store for tests and Mongo-less runs. Delete-then-return is atomic on the JS thread. */
export class InMemoryOAuthStateStore implements OAuthStateStore {
  private readonly rows = new Map<string, OAuthStateRecord>();

  constructor(private readonly now: () => number = Date.now) {}

  async create(rec: OAuthStateInput): Promise<string> {
    const state = newOAuthState();
    const at = this.now();
    this.rows.set(hashState(state), {
      ...structuredClone(rec),
      actor: rec.actor.trim().toLowerCase(),
      createdAt: new Date(at),
      expiresAt: new Date(at + OAUTH_STATE_TTL_MS),
    });
    return state;
  }

  async consume(state: string): Promise<OAuthStateRecord | null> {
    if (!plausible(state)) return null;
    const key = hashState(state);
    const rec = this.rows.get(key);
    if (!rec) return null;
    this.rows.delete(key);
    return rec.expiresAt.getTime() > this.now() ? structuredClone(rec) : null;
  }

  /** Test hook: how many states are stored (hashed). */
  get size(): number {
    return this.rows.size;
  }

  /** Test hook: the stored ids, to check the raw state is never kept. */
  keys(): string[] {
    return [...this.rows.keys()];
  }
}

/**
 * Per-user token storage.
 *
 * Multi-user deployments must never read or write one shared `token.json`.
 * Every subject gets its own entry, and tokens are encrypted at rest when a key
 * is configured.
 *
 * The `local` subject keeps using the historical `token.json` path so stdio
 * single-user installs continue to work without migration.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { config } from "./config.js";
import { logger } from "./logger.js";
import type { SavedToken } from "./types.js";

export interface TokenStore {
  get(subject: string): Promise<SavedToken | null>;
  set(subject: string, token: SavedToken): Promise<void>;
  delete(subject: string): Promise<void>;
}

interface EncryptedEnvelope {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

function isEnvelope(value: unknown): value is EncryptedEnvelope {
  const candidate = value as Partial<EncryptedEnvelope> | null;
  return (
    candidate?.v === 1 &&
    typeof candidate.iv === "string" &&
    typeof candidate.tag === "string" &&
    typeof candidate.data === "string"
  );
}

function deriveKey(secret: string): Buffer {
  // A stable 32-byte key from an arbitrary-length secret.
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

function fileSubject(subject: string): string {
  return crypto.createHash("sha256").update(subject, "utf8").digest("hex");
}

export interface FileTokenStoreOptions {
  /** Directory holding one file per subject. */
  dir: string;
  /** Optional AES-256-GCM key. Entries are encrypted when set. */
  encryptionKey?: string;
  /** Path used for the `local` subject (legacy token.json). */
  legacyPath?: string;
}

export class FileTokenStore implements TokenStore {
  private readonly dir: string;
  private readonly key: Buffer | null;
  private readonly legacyPath?: string;

  constructor(options: FileTokenStoreOptions) {
    this.dir = options.dir;
    this.key = options.encryptionKey ? deriveKey(options.encryptionKey) : null;
    this.legacyPath = options.legacyPath;
  }

  async get(subject: string): Promise<SavedToken | null> {
    const file = this.pathFor(subject);
    try {
      const raw = await fs.promises.readFile(file, "utf8");
      const parsed: unknown = JSON.parse(raw);
      const token = this.key ? this.decrypt(parsed) : (parsed as SavedToken);
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      // A corrupt or undecryptable entry must not take the server down; treat
      // it as unauthenticated and let the user re-authenticate.
      logger.error(`Failed to read token for subject "${subject}"`, error);
      return null;
    }
  }

  async set(subject: string, token: SavedToken): Promise<void> {
    const file = this.pathFor(subject);
    await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });

    const payload = this.key ? this.encrypt(token) : token;
    const temp = `${file}.${crypto.randomBytes(8).toString("hex")}.tmp`;

    let created = false;
    try {
      const fd = await fs.promises.open(temp, "wx", 0o600);
      created = true;
      try {
        await fd.writeFile(JSON.stringify(payload));
      } finally {
        await fd.close();
      }
      await fs.promises.rename(temp, file);
      created = false;
    } finally {
      if (created) {
        await fs.promises.unlink(temp).catch(() => undefined);
      }
    }
  }

  async delete(subject: string): Promise<void> {
    await fs.promises.unlink(this.pathFor(subject)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    });
  }

  private pathFor(subject: string): string {
    if (subject === "local" && this.legacyPath) {
      return this.legacyPath;
    }
    return path.join(this.dir, `${fileSubject(subject)}.json`);
  }

  private encrypt(token: SavedToken): EncryptedEnvelope {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key!, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(token), "utf8"),
      cipher.final(),
    ]);

    return {
      v: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    };
  }

  private decrypt(value: unknown): SavedToken {
    if (!isEnvelope(value)) {
      throw new Error("Token file is not an encrypted envelope");
    }

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.key!,
      Buffer.from(value.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(value.data, "base64")),
      decipher.final(),
    ]);

    return JSON.parse(plain.toString("utf8")) as SavedToken;
  }
}

let storeInstance: TokenStore | null = null;

/** Process-wide token store. Replaceable for tests. */
export function getTokenStore(): TokenStore {
  if (!storeInstance) {
    storeInstance = createTokenStore();
  }
  return storeInstance;
}

export function setTokenStore(store: TokenStore | null): void {
  storeInstance = store;
}

export function createTokenStore(): TokenStore {
  return new FileTokenStore({
    dir: config.tokenDir,
    encryptionKey: config.tokenEncryptionKey,
    legacyPath: config.tokenPath,
  });
}

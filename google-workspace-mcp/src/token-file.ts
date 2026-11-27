/**
 * Encrypted OAuth token file.
 *
 * Tokens are encrypted at rest with AES-256-GCM. The key comes from the
 * cross-platform secret store (env var, OS keychain, or private 0600 file).
 *
 * Existing plaintext `token.json` files are read transparently and re-written
 * encrypted on first load, so nobody has to re-authenticate.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { logger } from "./logger.js";
import { defaultKeyPath, deriveKeyMaterial, resolveSecret } from "./secret-store.js";
import type { SavedToken } from "./types.js";

interface Envelope {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

function isEnvelope(value: unknown): value is Envelope {
  const candidate = value as Partial<Envelope> | null;
  return (
    candidate?.v === 1 &&
    typeof candidate.iv === "string" &&
    typeof candidate.tag === "string" &&
    typeof candidate.data === "string"
  );
}

export interface TokenFileOptions {
  /** Override the resolved secret (tests / explicit configuration). */
  secret?: string | null;
  /** Skip the OS keychain when resolving the secret (tests). */
  disableKeychain?: boolean;
}

export class TokenFile {
  private readonly key: Buffer | null;

  constructor(
    private readonly filePath: string,
    options: TokenFileOptions = {}
  ) {
    let secret: string | null;
    if (options.secret !== undefined) {
      secret = options.secret;
    } else {
      secret = resolveSecret({
        keyPath: defaultKeyPath(filePath),
        allowFileBackend: !options.disableKeychain,
        backends: options.disableKeychain ? [] : undefined,
      });
    }
    this.key = secret ? deriveKeyMaterial(secret) : null;
  }

  /** True when token data will be encrypted at rest. */
  get encrypted(): boolean {
    return this.key !== null;
  }

  read(): SavedToken | null {
    if (!fs.existsSync(this.filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed: unknown = JSON.parse(raw);

      if (isEnvelope(parsed)) {
        if (!this.key) {
          logger.error("Token file is encrypted but no encryption key is available");
          return null;
        }
        return this.decrypt(parsed);
      }

      // Legacy plaintext token: migrate in place.
      const token = parsed as SavedToken;
      logger.warn("Migrating plaintext token file to encrypted storage");
      this.write(token);
      return token;
    } catch (error) {
      logger.error("Error loading saved token", error);
      return null;
    }
  }

  write(token: SavedToken): void {
    const payload: SavedToken | Envelope = this.key ? this.encrypt(token) : token;
    if (!this.key) {
      logger.warn(
        "No token encryption key available; the token file will remain plaintext with 0600 permissions"
      );
    }

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temp = `${this.filePath}.${crypto.randomBytes(8).toString("hex")}.tmp`;

    let created = false;
    try {
      const fd = fs.openSync(temp, "wx", 0o600);
      created = true;
      try {
        fs.writeFileSync(fd, JSON.stringify(payload));
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, this.filePath);
      created = false;
      fs.chmodSync(this.filePath, 0o600);
    } finally {
      if (created && fs.existsSync(temp)) {
        fs.unlinkSync(temp);
      }
    }
  }

  private encrypt(token: SavedToken): Envelope {
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

  private decrypt(envelope: Envelope): SavedToken {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.key!,
      Buffer.from(envelope.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plain.toString("utf8")) as SavedToken;
  }
}

/**
 * Cross-platform secret storage for the token encryption key.
 *
 * Resolution order:
 *   1. `GOOGLE_TOKEN_ENCRYPTION_KEY` (explicit, always wins)
 *   2. OS keychain
 *        - macOS: Keychain via `security`
 *        - Linux: Secret Service via `secret-tool`
 *        - Windows: DPAPI-encrypted key file via PowerShell
 *   3. Private key file with 0600 permissions (headless/containers)
 *
 * Every backend is best-effort: if the tool is missing or fails, resolution
 * falls through instead of crashing the server.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import { logger } from "./logger.js";

const SERVICE = "google-service-mcp";
const ACCOUNT = "token-key";

export interface SecretBackend {
  name: string;
  get(): string | null;
  set(secret: string): void;
}

function tryExec(command: string, args: string[], input?: string): string | null {
  try {
    return execFileSync(command, args, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
      input,
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
}

export class EnvBackend implements SecretBackend {
  readonly name = "env";
  constructor(private readonly value: string | undefined) {}
  get(): string | null {
    return this.value || null;
  }
  set(): void {
    throw new Error("The environment backend cannot persist a generated key");
  }
}

export class MacKeychainBackend implements SecretBackend {
  readonly name = "macos-keychain";
  get(): string | null {
    return tryExec("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
  }
  set(secret: string): void {
    execFileSync("security", [
      "add-generic-password",
      "-U",
      "-s",
      SERVICE,
      "-a",
      ACCOUNT,
      "-w",
      secret,
    ]);
  }
}

export class LinuxSecretServiceBackend implements SecretBackend {
  readonly name = "linux-secret-service";
  get(): string | null {
    return tryExec("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT]);
  }
  set(secret: string): void {
    execFileSync("secret-tool", [
      "store",
      `--label=${SERVICE}`,
      "service",
      SERVICE,
      "account",
      ACCOUNT,
    ], { input: secret, stdio: ["pipe", "ignore", "ignore"] });
  }
}

export class WindowsDpapiBackend implements SecretBackend {
  readonly name = "windows-dpapi";
  constructor(private readonly filePath: string) {}

  get(): string | null {
    if (!fs.existsSync(this.filePath)) {
      return null;
    }
    const safePath = this.filePath.replace(/'/g, "''");
    return tryExec("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$enc = Get-Content -Path '${safePath}' -Raw; ` +
        "$secure = ConvertTo-SecureString -String $enc; " +
        "$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); " +
        "[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)",
    ]);
  }

  set(secret: string): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$secure = ConvertTo-SecureString -String $env:GWS_KEY -AsPlainText -Force; " +
          "ConvertFrom-SecureString $secure | Set-Content -Path $env:GWS_KEY_PATH -NoNewline",
      ],
      {
        env: { ...process.env, GWS_KEY: secret, GWS_KEY_PATH: this.filePath },
        stdio: ["ignore", "ignore", "ignore"],
      }
    );
  }
}

export class FileKeyBackend implements SecretBackend {
  readonly name = "key-file";
  constructor(private readonly filePath: string) {}

  get(): string | null {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }
      return fs.readFileSync(this.filePath, "utf-8").trim() || null;
    } catch {
      return null;
    }
  }

  set(secret: string): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(this.filePath, "w", 0o600);
    try {
      fs.writeFileSync(fd, secret);
    } finally {
      fs.closeSync(fd);
    }
    fs.chmodSync(this.filePath, 0o600);
  }
}

/** Where the fallback key file lives, next to the token. */
export function defaultKeyPath(tokenPath: string): string {
  return `${tokenPath}.key`;
}

export interface ResolveKeyOptions {
  envKey?: string;
  keyPath: string;
  platform?: NodeJS.Platform;
  /** Test seam: override the UI/OS backends. */
  backends?: SecretBackend[];
  /** Test seam: disable the fallback file backend. */
  allowFileBackend?: boolean;
}

export function defaultBackends(keyPath: string, platform: NodeJS.Platform): SecretBackend[] {
  switch (platform) {
    case "darwin":
      return [new MacKeychainBackend()];
    case "linux":
      return [new LinuxSecretServiceBackend()];
    case "win32":
      return [new WindowsDpapiBackend(keyPath)];
    default:
      return [];
  }
}

/**
 * Resolve (or create) the secret used to encrypt the token file.
 * Returns null only when every backend is unavailable and file storage is
 * explicitly disallowed.
 */
export function resolveSecret(options: ResolveKeyOptions): string | null {
  const envKey = options.envKey ?? process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (envKey) {
    return envKey;
  }

  const platform = options.platform ?? os.platform();
  const backends = options.backends ?? defaultBackends(options.keyPath, platform);

  for (const backend of backends) {
    const existing = backend.get();
    if (existing) {
      return existing;
    }
  }

  const generated = crypto.randomBytes(32).toString("base64url");

  for (const backend of backends) {
    try {
      backend.set(generated);
      logger.info(`Generated token encryption key in ${backend.name}`);
      return generated;
    } catch {
      // Try the next backend.
    }
  }

  if (options.allowFileBackend === false) {
    return null;
  }

  const file = new FileKeyBackend(options.keyPath);
  try {
    file.set(generated);
    logger.warn(
      `No OS keychain available; storing the token encryption key at ${options.keyPath} (mode 0600)`
    );
    return generated;
  } catch (error) {
    logger.error("Could not persist a token encryption key", error);
    return null;
  }
}

/** Derive a stable 32-byte AES key from an arbitrary secret. */
export function deriveKeyMaterial(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

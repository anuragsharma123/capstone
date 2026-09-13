// Envelope encryption for connection tokens (Rule 3). See DESIGN-NOTES §2.6
// and connection-data-flow.html: a fresh per-connection data key (DEK)
// encrypts the token; the KMS master key encrypts (wraps) the DEK. Only the
// two ciphertexts are ever persisted — this module is the only place a
// plaintext token exists, and only for the instant it's in memory here.
//
// For this prototype the "KMS" is one master key in an env var (AES-256-GCM
// via node:crypto), per the documented floor: a single symmetric key
// already passes Rule 3's grep test — envelope encryption is the
// strengthening (key rotation without re-encrypting every token, a smaller
// secret exposed to the "KMS" boundary), not a requirement.
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { config } from "./config.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const masterKey = Buffer.from(config.KMS_MASTER_KEY, "base64");

function seal(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function unseal(sealed: Buffer | Uint8Array, key: Buffer): Buffer {
  const buf = Buffer.from(sealed);
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/** Encrypts a token with a fresh per-connection DEK, then wraps that DEK with the KMS master key. */
export function encryptToken(token: string): { ciphertext: Buffer; wrappedDek: Buffer } {
  const dek = randomBytes(32);
  const ciphertext = seal(Buffer.from(token, "utf-8"), dek);
  const wrappedDek = seal(dek, masterKey);
  return { ciphertext, wrappedDek };
}

/** Unwraps the DEK with the master key, then decrypts the token with the DEK. */
export function decryptToken(ciphertext: Buffer | Uint8Array, wrappedDek: Buffer | Uint8Array): string {
  const dek = unseal(wrappedDek, masterKey);
  return unseal(ciphertext, dek).toString("utf-8");
}

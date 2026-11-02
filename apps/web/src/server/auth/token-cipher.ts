// Encryption at rest for per-user Linear tokens (MIRROR-R17): AES-256-GCM from Node's
// crypto, a fresh 96-bit IV per value, and associated data that binds each ciphertext to
// its row and column, so a value copied to another user or column does not decrypt.
//
// Format: `v1:<iv>:<ciphertext>:<tag>`, base64url parts. The version names the key: v1 is
// TOKEN_ENCRYPTION_KEY. Rotating the key later adds v2 with a second key and re-encrypts
// on read; values with an unknown version are refused, never guessed.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const version = "v1";
const algorithm = "aes-256-gcm";
const ivBytes = 12;
const tagBytes = 16;

export class TokenDecryptionError extends Error {
  override name = "TokenDecryptionError";
}

export type TokenCipher = {
  encrypt(plaintext: string, associatedData: string): string;
  decrypt(value: string, associatedData: string): string;
};

/** `key` is 32 bytes in standard base64, as TOKEN_ENCRYPTION_KEY is validated. */
export function createTokenCipher(key: string): TokenCipher {
  const secret = Buffer.from(key, "base64");
  if (secret.length !== 32) throw new Error("token encryption key must be 32 bytes");

  return {
    encrypt(plaintext, associatedData) {
      const iv = randomBytes(ivBytes);
      const cipher = createCipheriv(algorithm, secret, iv, { authTagLength: tagBytes });
      cipher.setAAD(Buffer.from(associatedData, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [version, iv, ciphertext, tag]
        .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
        .join(":");
    },
    decrypt(value, associatedData) {
      const parts = value.split(":");
      if (parts.length !== 4 || parts[0] !== version) {
        throw new TokenDecryptionError("stored token has an unknown format or key version");
      }
      const [, iv, ciphertext, tag] = parts.map((part) => Buffer.from(part, "base64url"));
      if (iv?.length !== ivBytes || tag?.length !== tagBytes || !ciphertext) {
        throw new TokenDecryptionError("stored token is malformed");
      }
      try {
        const decipher = createDecipheriv(algorithm, secret, iv, { authTagLength: tagBytes });
        decipher.setAAD(Buffer.from(associatedData, "utf8"));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      } catch {
        throw new TokenDecryptionError("stored token does not decrypt with the current key");
      }
    },
  };
}

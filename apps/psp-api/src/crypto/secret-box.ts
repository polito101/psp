import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const SALT = 'psp-webhook-v1';

/**
 * Deriva una clave de 32 bytes a partir de `APP_ENCRYPTION_KEY` usando scrypt (salt fija interna).
 *
 * @returns {Buffer} Clave binaria lista para AES-256-GCM.
 * @throws {Error} Si la variable de entorno no está definida o tiene menos de 32 caracteres.
 */
function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new Error('APP_ENCRYPTION_KEY must be set (min 32 chars)');
  }
  return scryptSync(raw, SALT, 32);
}

/** Cifrado autenticado (IV + tag + ciphertext), base64url. */
export function encryptUtf8(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

export function decryptUtf8(payload: string): string {
  const key = getKey();
  const buf = Buffer.from(payload, 'base64url');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

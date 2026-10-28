// Encrypted backup container for the CLI / GitHub workflows: 'CTB1' magic + 12-byte IV + AES-256-GCM ciphertext +
// 16-byte tag. The magic is also bound as AAD, so a swapped header fails like a tampered body.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const CTB_MAGIC = Buffer.from('CTB1', 'ascii');
const IV = 12;
const TAG = 16;

/** BACKUP_KEY -> 32-byte Buffer. Accepts 64 hex chars or base64/base64url of exactly 32 bytes. Never echoes the key. */
export function parseKey(text) {
  const s = String(text ?? '').trim();
  if (!s) throw new Error('BACKUP_KEY is not set');
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) {
    const b = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (b.length === 32) return b;
  }
  throw new Error('BACKUP_KEY must be 32 bytes, as 64 hex characters or base64');
}

export function encrypt(plain, key) {
  const iv = randomBytes(IV);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(CTB_MAGIC);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([CTB_MAGIC, iv, body, c.getAuthTag()]);
}

export const isEncrypted = (buf) => buf.length >= 4 && buf.subarray(0, 4).equals(CTB_MAGIC);

export function decrypt(buf, key) {
  if (!isEncrypted(buf)) throw new Error('not an encrypted company-ticket backup (missing CTB1 header)');
  if (buf.length < 4 + IV + TAG) throw new Error('encrypted backup is truncated');
  const iv = buf.subarray(4, 4 + IV);
  const tag = buf.subarray(buf.length - TAG);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(CTB_MAGIC);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(buf.subarray(4 + IV, buf.length - TAG)), d.final()]);
  } catch {
    throw new Error('decryption failed: wrong BACKUP_KEY or the file was modified');
  }
}

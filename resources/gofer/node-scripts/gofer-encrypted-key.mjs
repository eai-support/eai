/**
 * Passphrase-encrypted Ed25519 signing key. A worker sandbox can read the
 * account home, so a plaintext signing key is forgeable by any worker. This
 * envelope is useless without a passphrase that only a person types at a
 * terminal. It is never read from the environment, a file, or an argument.
 */
import { createCipheriv, createDecipheriv, createPrivateKey, randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const denied = () => new Error('ENCRYPTED_KEY_REQUIRED');
const MIN_PASSPHRASE_LENGTH = 12;
const KDF = Object.freeze({ N: 2 ** 17, r: 8, p: 1, keyLength: 32, maxmem: 256 * 1024 * 1024 });
const b64 = value => Buffer.from(value).toString('base64url');
const fromB64 = (value, length) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw denied();
  const bytes = Buffer.from(value, 'base64url');
  if (length !== undefined && bytes.length !== length) throw denied();
  return bytes;
};

export function assertStrongPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) throw denied();
}

/** `privateKey` must be an Ed25519 KeyObject. */
export async function encryptSigningKey(privateKey, passphrase) {
  assertStrongPassphrase(passphrase);
  if (privateKey?.asymmetricKeyType !== 'ed25519') throw denied();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await derive(passphrase, salt, KDF.keyLength, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: KDF.maxmem });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('gofer-verifier-key-v1'));
  const ciphertext = Buffer.concat([cipher.update(privateKey.export({ type: 'pkcs8', format: 'der' })), cipher.final()]);
  return Object.freeze({ schemaVersion: 1, kdf: { name: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p, salt: b64(salt) },
    cipher: { name: 'aes-256-gcm', iv: b64(iv), tag: b64(cipher.getAuthTag()) }, ciphertext: b64(ciphertext) });
}

/** Returns an Ed25519 private KeyObject, or throws. A wrong passphrase and a
 * tampered envelope are indistinguishable by design. */
export async function decryptSigningKey(envelope, passphrase) {
  assertStrongPassphrase(passphrase);
  if (envelope?.schemaVersion !== 1 || envelope.kdf?.name !== 'scrypt' ||
      envelope.kdf.N !== KDF.N || envelope.kdf.r !== KDF.r || envelope.kdf.p !== KDF.p ||
      envelope.cipher?.name !== 'aes-256-gcm') throw denied();
  try {
    const key = await derive(passphrase, fromB64(envelope.kdf.salt, 16), KDF.keyLength,
      { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: KDF.maxmem });
    const decipher = createDecipheriv('aes-256-gcm', key, fromB64(envelope.cipher.iv, 12));
    decipher.setAAD(Buffer.from('gofer-verifier-key-v1'));
    decipher.setAuthTag(fromB64(envelope.cipher.tag, 16));
    const der = Buffer.concat([decipher.update(fromB64(envelope.ciphertext)), decipher.final()]);
    const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    if (privateKey.asymmetricKeyType !== 'ed25519') throw denied();
    return privateKey;
  } catch { throw denied(); }
}

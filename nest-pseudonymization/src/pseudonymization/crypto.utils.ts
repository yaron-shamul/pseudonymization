import * as crypto from 'crypto';

// PBKDF2 with 480k iterations costs ~300ms, so derive the AES key once per secret and reuse it.
// Same salt/iterations as before, so values encrypted earlier still decrypt.
const derivedKeys = new Map<string, Buffer>();

export class CryptoUtils {
  static deriveKey(secret: string): Buffer {
    let key = derivedKeys.get(secret);
    if (!key) {
      key = crypto.pbkdf2Sync(
        secret,
        Buffer.from('pseudonymization'),
        480000,
        32,
        'sha256',
      );
      derivedKeys.set(secret, key);
    }
    return key;
  }

  static sha256Hash(value: string): string {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
  }

  static createIdentityHash(objectId: string): string {
    // Identity = record ID only, so different IDs with the same name get different tokens.
    return CryptoUtils.sha256Hash(String(objectId));
  }

  static hmacSha256(secret: string, value: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(value, 'utf8')
      .digest('hex');
  }

  static encryptAes256Gcm(
    plaintext: string,
    secret: string,
  ): { nonce: string; ciphertext: string } {
    const key = CryptoUtils.deriveKey(secret);
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce, {
      authTagLength: 16,
    });
    const enc = Buffer.concat([
      cipher.update(Buffer.from(plaintext, 'utf8')),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    const ciphertext = Buffer.concat([enc, authTag]).toString('hex');
    return { nonce: nonce.toString('hex'), ciphertext };
  }

  static decryptAes256Gcm(
    nonceHex: string,
    ciphertextHex: string,
    secret: string,
  ): string {
    const key = CryptoUtils.deriveKey(secret);
    const nonce = Buffer.from(nonceHex, 'hex');
    const ct = Buffer.from(ciphertextHex, 'hex');
    const authTag = ct.slice(ct.length - 16);
    const enc = ct.slice(0, ct.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce, {
      authTagLength: 16,
    });
    decipher.setAuthTag(authTag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  }
}

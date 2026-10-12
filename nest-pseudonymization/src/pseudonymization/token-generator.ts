import { PSEUDONYMIZATION_SETTINGS } from './config.js';
import { CryptoUtils } from './crypto.utils.js';

export class TokenGenerator {
  private hmacSecret: string;
  private tokenLength: number;

  constructor(hmacSecret = process.env.PSEUDONYMIZATION_SECRET || '') {
    this.hmacSecret = hmacSecret || (process.env.PSEUDONYMIZATION_SECRET || '');
    const configuredLength = PSEUDONYMIZATION_SETTINGS.token_length || 7;
    this.tokenLength = configuredLength;
  }

  static defaultPrefix(fieldName: string): string {
    return `${fieldName.toUpperCase()}_`;
  }

  generateToken(fieldName: string, fieldValue: string, identityHash: string, prefix?: string): string {
    const tokenInput = `${identityHash}|${fieldName}|${fieldValue}`;
    const hmac = CryptoUtils.hmacSha256(this.hmacSecret, tokenInput);
    const suffix = hmac.slice(0, this.tokenLength).toUpperCase();
    return `${prefix ?? TokenGenerator.defaultPrefix(fieldName)}${suffix}`;
  }

  isValidToken(token: string): boolean {
    // Prefixes are request-defined, so only the hex suffix shape is checked.
    return new RegExp(`_[0-9A-F]{${this.tokenLength}}$`).test(token);
  }
}

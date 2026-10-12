import { BadRequestException, Injectable } from '@nestjs/common';
import { InMemoryMappingRepository } from './repository.js';
import { TokenGenerator } from './token-generator.js';
import { CryptoUtils } from './crypto.utils.js';
import { PSEUDONYMIZATION_SETTINGS, HMAC_SECRET, DEFAULT_ID_FIELD } from './config.js';
import { AnonymizationResult, DeanonymizationResult } from './models.js';

export interface FieldConfig {
  enabled?: boolean;
  prefix?: string;
  description?: string;
}

/**
 * Fields to pseudonymize, sent by the caller on every request. Either:
 *  - a list of field names:            ["name", "email"]
 *  - a map with per-field options:     { "name": { "prefix": "USER_" }, "email": true, "phone": false }
 */
export type FieldsSpec = string[] | Record<string, FieldConfig | boolean>;

/** Back-compat alias for the old `config` request property. */
export type AnonymizationConfig = Record<string, FieldConfig | boolean>;

export interface PseudonymizationOptions {
  /** Field that identifies the record; tokens are scoped to its value. Defaults to "id". */
  idField?: string;
}

type ResolvedFields = Map<string, { prefix: string }>;

@Injectable()
export class PseudonymizationService {
  private repository: InMemoryMappingRepository;
  private tokenGenerator: TokenGenerator;
  private hmacSecret: string;
  private enableEncryption: boolean;

  constructor() {
    this.repository = new InMemoryMappingRepository();
    this.hmacSecret = HMAC_SECRET;
    this.tokenGenerator = new TokenGenerator(this.hmacSecret);
    this.enableEncryption = PSEUDONYMIZATION_SETTINGS.enable_encryption ?? true;
    // Pay the PBKDF2 cost at startup instead of on the first request
    if (this.enableEncryption) CryptoUtils.deriveKey(this.hmacSecret);
  }

  anonymize(obj: Record<string, any>, fields: FieldsSpec, options: PseudonymizationOptions = {}): AnonymizationResult {
    const resolved = this.resolveFields(fields);
    if (resolved.size === 0) {
      throw new BadRequestException('`fields` must list at least one field to pseudonymize');
    }
    this.assertRecord(obj);

    const idField = options.idField ?? DEFAULT_ID_FIELD;
    const objectId = String(obj[idField] ?? '');
    const identityHash = CryptoUtils.createIdentityHash(objectId);

    const anonymized = { ...obj };
    const mappings: Record<string, any> = {};

    for (const [fieldName, fieldValue] of Object.entries(obj)) {
      const fieldCfg = resolved.get(fieldName);
      if (!fieldCfg) continue;
      if (fieldValue == null) continue;

      const token = this.tokenGenerator.generateToken(fieldName, String(fieldValue), identityHash, fieldCfg.prefix);
      const originalValueHash = CryptoUtils.sha256Hash(String(fieldValue));

      let encryptedValue: string | null = null;
      if (this.enableEncryption) {
        try {
          const { nonce, ciphertext } = CryptoUtils.encryptAes256Gcm(String(fieldValue), this.hmacSecret);
          encryptedValue = `${nonce}:${ciphertext}`;
        } catch {
          // ignore
        }
      }

      const mapping = {
        token,
        original_value: String(fieldValue),
        original_value_hash: originalValueHash,
        field_name: fieldName,
        identity_hash: identityHash,
        encrypted_value: encryptedValue,
        metadata: {},
      };

      this.repository.saveMapping(mapping);
      mappings[fieldName] = mapping;
      anonymized[fieldName] = token;
    }

    return { anonymized_object: anonymized, identity_hash: identityHash, mappings };
  }

  /**
   * Restores tokens back to original values. When `fields` is given, only those fields are
   * restored; otherwise every value that looks like a token is resolved.
   */
  deanonymize(
    anonymizedObj: Record<string, any>,
    fields?: FieldsSpec,
    options: PseudonymizationOptions = {},
  ): DeanonymizationResult {
    this.assertRecord(anonymizedObj);
    const restrictTo = fields !== undefined && fields !== null ? this.resolveFields(fields) : null;

    const deanonymized = { ...anonymizedObj };
    const mappingsUsed: Record<string, any> = {};
    // Determine identity context from object id so tokens are scoped per ID
    const idField = options.idField ?? DEFAULT_ID_FIELD;
    const objectId = String(anonymizedObj[idField] ?? '');
    const identityHashContext = CryptoUtils.createIdentityHash(objectId);

    for (const [fieldName, fieldValue] of Object.entries(anonymizedObj)) {
      if (restrictTo && !restrictTo.has(fieldName)) continue;
      if (typeof fieldValue !== 'string') continue;
      if (!this.tokenGenerator.isValidToken(fieldValue)) continue;

      // Lookup is scoped to this record's identity, so a token from another ID never resolves here
      const mapping = this.repository.getByToken(fieldValue, identityHashContext);
      if (!mapping) {
        // token not found for this identity -> leave as-is
        continue;
      }

      let originalValue = mapping.original_value;
      if (mapping.encrypted_value && this.enableEncryption) {
        try {
          const [nonce, ciphertext] = (mapping.encrypted_value as string).split(':');
          originalValue = CryptoUtils.decryptAes256Gcm(nonce, ciphertext, this.hmacSecret);
        } catch {
          // ignore, fall back to stored original_value
        }
      }

      deanonymized[fieldName] = originalValue;
      mappingsUsed[fieldName] = mapping;
    }

    const identityHash = Object.values(mappingsUsed)[0]?.identity_hash ?? null;
    return { deanonymized_object: deanonymized, identity_hash: identityHash, mappings_used: mappingsUsed };
  }

  anonymizeBatch(objects: Record<string, any>[], fields: FieldsSpec, options?: PseudonymizationOptions) {
    return objects.map((o) => this.anonymize(o, fields, options));
  }

  deanonymizeBatch(objects: Record<string, any>[], fields?: FieldsSpec, options?: PseudonymizationOptions) {
    return objects.map((o) => this.deanonymize(o, fields, options));
  }

  getStats() {
    return {
      ...this.repository.getStats(),
      tokenLength: this.tokenGenerator['tokenLength'],
      identityScope: 'object_id_scoped',
      // Tokens are unique per identity, so this is the token space per field *per user*, not a cap on users
      tokenSpacePerIdentityField: `16^${this.tokenGenerator['tokenLength']} ≈ ${Math.pow(16, this.tokenGenerator['tokenLength']).toLocaleString()}`,
      note: 'POC: in-memory repository; DB-backed store to be added later',
    };
  }

  private resolveFields(fields: FieldsSpec): ResolvedFields {
    const resolved: ResolvedFields = new Map();
    const add = (name: string, prefix?: string) => {
      const p = prefix?.trim() ? prefix.trim() : TokenGenerator.defaultPrefix(name);
      resolved.set(name, { prefix: p.endsWith('_') ? p : `${p}_` });
    };

    if (Array.isArray(fields)) {
      for (const f of fields) {
        if (typeof f !== 'string' || !f.trim()) {
          throw new BadRequestException('`fields` array must contain non-empty field names');
        }
        add(f.trim());
      }
      return resolved;
    }

    if (fields && typeof fields === 'object') {
      for (const [name, cfg] of Object.entries(fields)) {
        if (cfg === true) add(name);
        else if (cfg && typeof cfg === 'object' && cfg.enabled !== false) add(name, cfg.prefix);
      }
      return resolved;
    }

    throw new BadRequestException('`fields` must be an array of field names or an object of field configs');
  }

  private assertRecord(obj: unknown): asserts obj is Record<string, any> {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new BadRequestException('each `data` record must be a JSON object');
    }
  }
}

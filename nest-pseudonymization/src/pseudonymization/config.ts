// Which fields to pseudonymize (and their token prefixes) is not defined here:
// every request sends it via the `fields` property. Only engine-level settings live here.

export const PSEUDONYMIZATION_SETTINGS = {
  enable_encryption: true,
  token_length: 7,
};

export const DEFAULT_ID_FIELD = 'id';

export const HMAC_SECRET =
  process.env.HMAC_SECRET || process.env.PSEUDONYMIZATION_SECRET || 'your-super-secret-key-change-in-production';

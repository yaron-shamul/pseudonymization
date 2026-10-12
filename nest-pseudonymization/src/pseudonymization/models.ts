export interface TokenMapping {
  token: string;
  original_value: string;
  original_value_hash: string;
  field_name: string;
  identity_hash: string;
  encrypted_value?: string | null;
  metadata?: Record<string, any>;
}

export interface AnonymizationResult {
  anonymized_object: Record<string, any>;
  identity_hash: string | null;
  mappings: Record<string, TokenMapping>;
}

export interface DeanonymizationResult {
  deanonymized_object: Record<string, any>;
  identity_hash: string | null;
  mappings_used: Record<string, TokenMapping>;
}

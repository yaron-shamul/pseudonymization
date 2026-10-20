import { TokenMapping } from './models.js';

// Tokens are only unique within one identity (record ID), so the lookup key includes the
// identity hash. Two different users can legitimately share a 7-char token suffix.
const tokenKey = (identityHash: string, token: string) =>
  `${identityHash}|${token}`;

// POC store: in-memory, so mappings are lost on restart.
export class InMemoryMappingRepository {
  private tokenToMapping = new Map<string, TokenMapping>();
  private identities = new Set<string>();
  private collisionCount = 0;

  saveMapping(mapping: TokenMapping): void {
    const key = tokenKey(mapping.identity_hash, mapping.token);
    const existing = this.tokenToMapping.get(key);
    if (
      existing &&
      existing.original_value_hash !== mapping.original_value_hash
    ) {
      this.collisionCount += 1;
      throw new Error(
        `Token collision detected for token=${mapping.token} within the same identity`,
      );
    }
    this.tokenToMapping.set(key, mapping);
    this.identities.add(mapping.identity_hash);
  }

  getByToken(token: string, identityHash: string): TokenMapping | null {
    return this.tokenToMapping.get(tokenKey(identityHash, token)) || null;
  }

  getStats(): {
    totalMappings: number;
    totalIdentities: number;
    collisionCount: number;
  } {
    return {
      totalMappings: this.tokenToMapping.size,
      totalIdentities: this.identities.size,
      collisionCount: this.collisionCount,
    };
  }
}

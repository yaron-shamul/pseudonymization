import { Injectable } from '@nestjs/common';
import { CAPTURE_FAILED_REQUESTS } from './config.js';

export type ActivitySource = 'portal' | 'lookup' | 'api';

export interface ActivityEntry {
  id: number;
  at: string;
  action: string;
  source: ActivitySource;
  records: number;
  /** Field names only — never values or tokens. */
  fields: string[];
  status: number;
  ok: boolean;
  ms: number;
  /** Request path, e.g. /pseudonymization or a deprecated per-action path. */
  endpoint: string;
  idField: string;
  /** Field values tokenized or restored (successful requests). */
  values?: number;
  /** Deanonymize: values in the requested fields that did not resolve (not a token, or unknown for that record ID). */
  unresolved?: number;
  /** Error message returned to the client (failed requests). */
  error?: string;
  userAgent?: string;
  /** Failed requests: the request and response are kept (see FailedExchange) and can be fetched by id. */
  captured?: boolean;
  /** Failed requests whose body was too large to keep: its size in bytes. */
  capturedTooLarge?: number;
}

/** What a failed request sent and got back — raw data, kept only for failed requests. */
export interface FailedExchange {
  request: {
    method: 'POST';
    path: string;
    headers: Record<string, string>;
    body: unknown;
  };
  response: { status: number; body: unknown };
}

const MAX_ENTRIES = 200;
const MAX_FIELDS = 20;
const MAX_CAPTURED = 50; // failed exchanges kept
const MAX_CAPTURE_BYTES = 256 * 1024; // per request body

/** Recent requests to the pseudonymization endpoint (metadata only), newest first. In memory. */
@Injectable()
export class ActivityService {
  private entries: ActivityEntry[] = [];
  private exchanges = new Map<number, FailedExchange>(); // insertion order = oldest first
  private nextId = 1;

  record(
    entry: Omit<
      ActivityEntry,
      'id' | 'at' | 'fields' | 'captured' | 'capturedTooLarge'
    > & { fields: unknown },
    exchange?: FailedExchange,
  ) {
    const id = this.nextId++;
    let captured: boolean | undefined;
    let capturedTooLarge: number | undefined;
    if (exchange && CAPTURE_FAILED_REQUESTS) {
      const size = Buffer.byteLength(
        JSON.stringify(exchange.request.body) ?? '',
      );
      if (size <= MAX_CAPTURE_BYTES) {
        this.exchanges.set(id, exchange);
        captured = true;
        for (const old of this.exchanges.keys()) {
          if (this.exchanges.size <= MAX_CAPTURED) break;
          this.exchanges.delete(old);
        }
      } else {
        capturedTooLarge = size;
      }
    }
    this.entries.unshift({
      ...entry,
      id,
      captured,
      capturedTooLarge,
      at: new Date().toISOString(),
      fields: fieldNames(entry.fields),
      error: entry.error?.slice(0, 300),
      userAgent: entry.userAgent?.slice(0, 160),
    });
    if (this.entries.length > MAX_ENTRIES) this.entries.length = MAX_ENTRIES;
  }

  list(limit = MAX_ENTRIES): ActivityEntry[] {
    // An entry only claims a capture while the exchange is still kept
    return this.entries
      .slice(0, Math.max(0, Math.min(limit, MAX_ENTRIES)))
      .map((e) =>
        e.captured && !this.exchanges.has(e.id) ? { ...e, captured: false } : e,
      );
  }

  exchange(id: number): FailedExchange | undefined {
    return this.exchanges.get(id);
  }
}

/** Normalises the request's `fields` (array or object) to a short list of names; ignores anything else. */
export function fieldNames(fields: unknown): string[] {
  const names = Array.isArray(fields)
    ? fields
    : fields && typeof fields === 'object'
      ? Object.keys(fields)
      : [];
  return names
    .filter((f): f is string => typeof f === 'string')
    .map((f) => f.slice(0, 64))
    .slice(0, MAX_FIELDS);
}

/** The portal tags its requests with an X-Client header; everything else counts as a direct API call. */
export function sourceFromHeader(
  header: string | string[] | undefined,
): ActivitySource {
  const value = Array.isArray(header) ? header[0] : header;
  return value === 'portal' || value === 'lookup' ? value : 'api';
}

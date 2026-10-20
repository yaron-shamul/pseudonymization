import { Injectable } from '@nestjs/common';

export type UsageOperation = 'anonymize' | 'deanonymize';

export interface Counts {
  anonymize: number; // records anonymized
  deanonymize: number; // records deanonymized
  fields: number; // field values tokenized or restored
  requests: number;
  errors: number;
}

const MINUTE = 60_000;
const RETENTION_MINUTES = 7 * 24 * 60;

// Range -> bucket size (minutes) and bucket count
export const USAGE_RANGES = {
  '1h': { bucketMinutes: 1, buckets: 60 },
  '24h': { bucketMinutes: 15, buckets: 96 },
  '7d': { bucketMinutes: 60, buckets: 168 },
} as const;
export type UsageRange = keyof typeof USAGE_RANGES;

const empty = (): Counts => ({
  anonymize: 0,
  deanonymize: 0,
  fields: 0,
  requests: 0,
  errors: 0,
});

/** Per-minute API usage counters. In memory (reset on restart). */
@Injectable()
export class UsageService {
  private minutes = new Map<number, Counts>();

  record(op: UsageOperation, records: number, fields: number) {
    const c = this.bucket();
    c[op] += records;
    c.fields += fields;
    c.requests += 1;
  }

  recordError() {
    const c = this.bucket();
    c.requests += 1;
    c.errors += 1;
  }

  get(range: UsageRange) {
    const { bucketMinutes, buckets } = USAGE_RANGES[range];
    const size = bucketMinutes * MINUTE;
    const end = Math.floor(Date.now() / size) * size; // start of the current bucket
    const start = end - (buckets - 1) * size;

    const series = Array.from({ length: buckets }, (_, i) => ({
      t: new Date(start + i * size).toISOString(),
      ...empty(),
    }));
    const totals = empty();
    for (const [minute, counts] of this.minutes) {
      const ts = minute * MINUTE;
      if (ts < start) continue;
      const idx = Math.floor((ts - start) / size);
      if (idx >= buckets) continue;
      for (const k of Object.keys(totals) as (keyof Counts)[]) {
        series[idx][k] += counts[k];
        totals[k] += counts[k];
      }
    }
    return { range, bucketMinutes, totals, series };
  }

  private bucket(): Counts {
    const minute = Math.floor(Date.now() / MINUTE);
    let c = this.minutes.get(minute);
    if (!c) {
      c = empty();
      this.minutes.set(minute, c);
      // Drop buckets older than the retention window (Map keeps insertion order = time order)
      for (const k of this.minutes.keys()) {
        if (k > minute - RETENTION_MINUTES) break;
        this.minutes.delete(k);
      }
    }
    return c;
  }
}

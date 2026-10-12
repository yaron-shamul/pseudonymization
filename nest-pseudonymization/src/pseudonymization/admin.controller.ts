import { BadRequestException, Controller, Get, Post, Body, Query } from '@nestjs/common';
import { PseudonymizationService, AnonymizationConfig, FieldsSpec } from './pseudonymization.service.js';
import { UsageService, USAGE_RANGES, UsageRange } from './usage.service.js';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly service: PseudonymizationService,
    private readonly usage: UsageService,
  ) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'pseudonymization-admin',
      features: ['anonymize', 'deanonymize', 'batch', 'stats', 'usage', 'demo'],
    };
  }

  @Get('stats')
  stats() {
    return this.service.getStats();
  }

  @Get('usage')
  usageOverTime(@Query('range') range: string = '24h') {
    if (!(range in USAGE_RANGES)) {
      throw new BadRequestException(`range must be one of: ${Object.keys(USAGE_RANGES).join(', ')}`);
    }
    return this.usage.get(range as UsageRange);
  }

  @Get('demo')
  demo() {
    const sample = [
      { id: 'A001', name: 'John Smith', email: 'john@example.com', phone: '+1234567890' },
      { id: 'A002', name: 'Jane Roe', email: 'jane@example.com', phone: '+1987654321' },
      { id: 'A003', name: 'John Smith', email: 'john.smith2@example.com', phone: '+447700900123' },
    ];

    // Default config (all fields enabled)
    const defaultConfig: AnonymizationConfig = {
      name: { enabled: true },
      email: { enabled: true },
      phone: { enabled: true },
    };

    const anonymized = sample.map((record) => this.service.anonymize(record, defaultConfig));
    const deanonymized = anonymized.map((result) => this.service.deanonymize(result.anonymized_object, defaultConfig));

    return {
      source: sample,
      anonymized,
      deanonymized,
      summary: {
        totalRecords: sample.length,
        totalIdentities: new Set(anonymized.map((x) => x.identity_hash)).size,
        totalMappings: anonymized.reduce((acc, r) => acc + Object.keys(r.mappings).length, 0),
      },
    };
  }

  @Post('demo-seed')
  seedDemo(@Body() body: { records?: Record<string, any>[]; fields?: FieldsSpec; config?: AnonymizationConfig } = {}) {
    const records = body?.records ?? [
      { id: 'A010', name: 'Alice Brown', email: 'alice@example.com', phone: '+15551234567' },
      { id: 'A011', name: 'Alice Brown', email: 'alice.alt@example.com', phone: '+15557654321' },
    ];

    const fields = body?.fields ?? body?.config ?? ['name', 'email', 'phone'];

    return records.map((record) => this.service.anonymize(record, fields));
  }
}

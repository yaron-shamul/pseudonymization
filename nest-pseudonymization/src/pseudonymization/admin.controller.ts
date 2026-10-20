import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  ParseIntPipe,
  NotFoundException,
} from '@nestjs/common';
import {
  PseudonymizationService,
  AnonymizationConfig,
  FieldsSpec,
} from './pseudonymization.service.js';
import { UsageService, USAGE_RANGES, UsageRange } from './usage.service.js';
import { ActivityService } from './activity.service.js';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly service: PseudonymizationService,
    private readonly usage: UsageService,
    private readonly activity: ActivityService,
  ) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'pseudonymization-admin',
      features: [
        'anonymize',
        'deanonymize',
        'batch',
        'stats',
        'usage',
        'status',
        'activity',
        'demo',
      ],
    };
  }

  /** Per-component status for the dashboard (kept separate from /health, which the container healthcheck uses). */
  @Get('status')
  systemStatus() {
    const stats = this.service.getStats();
    return {
      api: { state: 'up', uptimeSeconds: Math.round(process.uptime()) },
      store: {
        state: 'up',
        type: 'in-memory',
        mappings: stats.totalMappings,
        collisions: stats.collisionCount,
      },
    };
  }

  @Get('stats')
  stats() {
    return this.service.getStats();
  }

  @Get('usage')
  usageOverTime(@Query('range') range: string = '24h') {
    if (!(range in USAGE_RANGES)) {
      throw new BadRequestException(
        `range must be one of: ${Object.keys(USAGE_RANGES).join(', ')}`,
      );
    }
    return this.usage.get(range as UsageRange);
  }

  /** Recent requests to /pseudonymization from any client (metadata, newest first). */
  @Get('activity')
  recentActivity(@Query('limit') limit?: string) {
    const n = Number(limit ?? 200);
    return { entries: this.activity.list(Number.isFinite(n) ? n : 200) };
  }

  /** The request and response of a failed request, while it is still kept (the last 50). */
  @Get('activity/:id/exchange')
  activityExchange(@Param('id', ParseIntPipe) id: number) {
    const exchange = this.activity.exchange(id);
    if (!exchange)
      throw new NotFoundException(
        `No request/response kept for request #${id}`,
      );
    return exchange;
  }

  @Get('demo')
  demo() {
    const sample = [
      {
        id: 'A001',
        name: 'John Smith',
        email: 'john@example.com',
        phone: '+1234567890',
      },
      {
        id: 'A002',
        name: 'Jane Roe',
        email: 'jane@example.com',
        phone: '+1987654321',
      },
      {
        id: 'A003',
        name: 'John Smith',
        email: 'john.smith2@example.com',
        phone: '+447700900123',
      },
    ];

    // Default config (all fields enabled)
    const defaultConfig: AnonymizationConfig = {
      name: { enabled: true },
      email: { enabled: true },
      phone: { enabled: true },
    };

    const anonymized = sample.map((record) =>
      this.service.anonymize(record, defaultConfig),
    );
    const deanonymized = anonymized.map((result) =>
      this.service.deanonymize(result.anonymized_object, defaultConfig),
    );

    return {
      source: sample,
      anonymized,
      deanonymized,
      summary: {
        totalRecords: sample.length,
        totalIdentities: new Set(anonymized.map((x) => x.identity_hash)).size,
        totalMappings: anonymized.reduce(
          (acc, r) => acc + Object.keys(r.mappings).length,
          0,
        ),
      },
    };
  }

  @Post('demo-seed')
  seedDemo(
    @Body()
    body: {
      records?: Record<string, any>[];
      fields?: FieldsSpec;
      config?: AnonymizationConfig;
    } = {},
  ) {
    const records = body?.records ?? [
      {
        id: 'A010',
        name: 'Alice Brown',
        email: 'alice@example.com',
        phone: '+15551234567',
      },
      {
        id: 'A011',
        name: 'Alice Brown',
        email: 'alice.alt@example.com',
        phone: '+15557654321',
      },
    ];

    const fields = body?.fields ?? body?.config ?? ['name', 'email', 'phone'];

    return records.map((record) => this.service.anonymize(record, fields));
  }
}

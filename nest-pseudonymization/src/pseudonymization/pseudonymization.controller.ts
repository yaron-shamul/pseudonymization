import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PseudonymizationService, FieldsSpec, AnonymizationConfig } from './pseudonymization.service.js';
import { UsageService, UsageOperation } from './usage.service.js';

export interface PseudonymizationRequest {
  /** A single record or an array of records. */
  data: Record<string, any> | Record<string, any>[];
  /** Which fields to pseudonymize — see FieldsSpec. */
  fields?: FieldsSpec;
  /** @deprecated use `fields` */
  config?: AnonymizationConfig;
  /** Field that identifies the record (tokens are scoped to it). Defaults to "id". */
  idField?: string;
}

@Controller('pseudonymization')
export class PseudonymizationController {
  constructor(
    private readonly service: PseudonymizationService,
    private readonly usage: UsageService,
  ) {}

  @Post('anonymize')
  anonymize(@Body() body: PseudonymizationRequest) {
    return this.tracked('anonymize', () => {
      const fields = body?.fields ?? body?.config;
      if (fields === undefined || fields === null) {
        throw new BadRequestException('`fields` is required: list the fields to pseudonymize, e.g. ["name","email"]');
      }
      const data = this.requireData(body);
      const options = { idField: body.idField };
      return Array.isArray(data)
        ? this.service.anonymizeBatch(data, fields, options)
        : this.service.anonymize(data, fields, options);
    });
  }

  @Post('deanonymize')
  deanonymizePost(@Body() body: PseudonymizationRequest) {
    return this.tracked('deanonymize', () => {
      const fields = body?.fields ?? body?.config;
      const data = this.requireData(body);
      const options = { idField: body.idField };
      return Array.isArray(data)
        ? this.service.deanonymizeBatch(data, fields, options)
        : this.service.deanonymize(data, fields, options);
    });
  }

  @Get('deanonymize')
  deanonymizeGet(@Query('record') record: string, @Query('fields') fields?: string, @Query('idField') idField?: string) {
    let parsed: Record<string, any> = {};
    try {
      parsed = record ? JSON.parse(record) : {};
    } catch {
      throw new BadRequestException('record must be valid JSON');
    }
    const fieldList = fields ? fields.split(',').map((f) => f.trim()).filter(Boolean) : undefined;
    return this.tracked('deanonymize', () => this.service.deanonymize(parsed, fieldList, { idField }));
  }

  /** Runs an operation and records it in the usage counters (records, fields, errors). */
  private tracked<T extends object | object[]>(op: UsageOperation, fn: () => T): T {
    let result: T;
    try {
      result = fn();
    } catch (e) {
      this.usage.recordError();
      throw e;
    }
    const list = (Array.isArray(result) ? result : [result]) as Record<string, any>[];
    const fields = list.reduce((n, r) => n + Object.keys(r.mappings ?? r.mappings_used ?? {}).length, 0);
    this.usage.record(op, list.length, fields);
    return result;
  }

  private requireData(body: PseudonymizationRequest) {
    if (!body || body.data === undefined || body.data === null || typeof body.data !== 'object') {
      throw new BadRequestException('`data` is required: a JSON object or an array of objects');
    }
    return body.data;
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  Post,
} from '@nestjs/common';
import {
  PseudonymizationService,
  FieldsSpec,
  AnonymizationConfig,
} from './pseudonymization.service.js';
import { UsageService } from './usage.service.js';
import { DEFAULT_ID_FIELD } from './config.js';
import {
  ActivityService,
  FailedExchange,
  fieldNames,
  sourceFromHeader,
} from './activity.service.js';

export const ACTIONS = ['anonymize', 'deanonymize'] as const;
export type Action = (typeof ACTIONS)[number];

export interface PseudonymizationRequest {
  /** What to do with the selected fields. */
  action: Action;
  /** A single record or an array of records. */
  data: Record<string, any> | Record<string, any>[];
  /** Which fields to anonymize / deanonymize — see FieldsSpec. Required for both actions. */
  fields: FieldsSpec;
  /** Field that identifies the record (tokens are scoped to it). Defaults to "id". */
  idField?: string;
}

/** Body of the legacy per-action endpoints: no `action`, and `config` was the old name of `fields`. */
type LegacyRequest = Omit<PseudonymizationRequest, 'action' | 'fields'> & {
  fields?: FieldsSpec;
  config?: AnonymizationConfig;
};

@Controller('pseudonymization')
export class PseudonymizationController {
  constructor(
    private readonly service: PseudonymizationService,
    private readonly usage: UsageService,
    private readonly activity: ActivityService,
  ) {}

  /** POST /pseudonymization — { action, data, fields, idField? } */
  @Post()
  @HttpCode(200)
  run(
    @Body() body: PseudonymizationRequest,
    @Headers('x-client') client?: string,
    @Headers('user-agent') userAgent?: string,
    endpoint = '/pseudonymization',
  ) {
    const started = Date.now();
    const log = (
      status: number,
      details: { values?: number; unresolved?: number; error?: string },
      exchange?: FailedExchange,
    ) =>
      this.activity.record(
        {
          action:
            typeof body?.action === 'string'
              ? body.action.slice(0, 32)
              : 'unknown',
          source: sourceFromHeader(client),
          records: Array.isArray(body?.data)
            ? body.data.length
            : body?.data && typeof body.data === 'object'
              ? 1
              : 0,
          fields: body?.fields,
          status,
          ok: status < 400,
          ms: Date.now() - started,
          endpoint,
          idField:
            typeof body?.idField === 'string' && body.idField
              ? body.idField
              : DEFAULT_ID_FIELD,
          userAgent,
          ...details,
        },
        exchange,
      );
    try {
      const action = this.requireAction(body?.action);
      const data = this.requireData(body);
      const fields = this.requireFields(body?.fields, action);
      const result = this.execute(action, data, fields, body.idField);
      const values = this.recordUsage(action, result);
      log(200, {
        values,
        unresolved:
          action === 'deanonymize'
            ? this.countUnresolved(data, fields, values)
            : undefined,
      });
      return result;
    } catch (e) {
      this.usage.recordError();
      const status = e instanceof HttpException ? e.getStatus() : 500;
      const responseBody =
        e instanceof HttpException
          ? httpErrorBody(e)
          : { statusCode: 500, message: 'Internal server error' };
      log(
        status,
        { error: errorMessage(e) },
        {
          request: {
            method: 'POST',
            path: endpoint,
            headers: {
              'Content-Type': 'application/json',
              ...(client ? { 'X-Client': String(client) } : {}),
            },
            body: body ?? null,
          },
          response: { status, body: responseBody },
        },
      );
      throw e;
    }
  }

  /** @deprecated use POST /pseudonymization with "action": "anonymize" */
  @Post('anonymize')
  anonymize(
    @Body() body: LegacyRequest,
    @Headers('x-client') client?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.run(
      {
        ...body,
        action: 'anonymize',
        fields: (body?.fields ?? body?.config) as FieldsSpec,
      },
      client,
      userAgent,
      '/pseudonymization/anonymize',
    );
  }

  /** @deprecated use POST /pseudonymization with "action": "deanonymize" */
  @Post('deanonymize')
  deanonymize(
    @Body() body: LegacyRequest,
    @Headers('x-client') client?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.run(
      {
        ...body,
        action: 'deanonymize',
        fields: (body?.fields ?? body?.config) as FieldsSpec,
      },
      client,
      userAgent,
      '/pseudonymization/deanonymize',
    );
  }

  private execute(
    action: Action,
    data: Record<string, any> | Record<string, any>[],
    fields: FieldsSpec,
    idField?: string,
  ) {
    const options = { idField };
    if (action === 'anonymize') {
      return Array.isArray(data)
        ? this.service.anonymizeBatch(data, fields, options)
        : this.service.anonymize(data, fields, options);
    }
    return Array.isArray(data)
      ? this.service.deanonymizeBatch(data, fields, options)
      : this.service.deanonymize(data, fields, options);
  }

  /** Records the usage counters and returns the number of field values processed. */
  private recordUsage(action: Action, result: object | object[]) {
    const list = (Array.isArray(result) ? result : [result]) as Record<
      string,
      any
    >[];
    const fields = list.reduce(
      (n, r) => n + Object.keys(r.mappings ?? r.mappings_used ?? {}).length,
      0,
    );
    this.usage.record(action, list.length, fields);
    return fields;
  }

  /** Requested string values that were not restored (not a token, or not issued for that record ID). */
  private countUnresolved(
    data: Record<string, any> | Record<string, any>[],
    fields: FieldsSpec,
    restored: number,
  ) {
    const names = fieldNames(fields);
    const records = Array.isArray(data) ? data : [data];
    const requested = records.reduce(
      (n, r) => n + names.filter((f) => typeof r?.[f] === 'string').length,
      0,
    );
    return Math.max(0, requested - restored);
  }

  private requireAction(action: unknown): Action {
    if (!ACTIONS.includes(action as Action)) {
      throw new BadRequestException(
        `\`action\` is required: one of ${ACTIONS.map((a) => `"${a}"`).join(', ')}`,
      );
    }
    return action as Action;
  }

  private requireData(body: Partial<PseudonymizationRequest>) {
    if (
      !body ||
      body.data === undefined ||
      body.data === null ||
      typeof body.data !== 'object'
    ) {
      throw new BadRequestException(
        '`data` is required: a JSON object or an array of objects',
      );
    }
    return body.data;
  }

  private requireFields(
    fields: FieldsSpec | undefined,
    action: Action,
  ): FieldsSpec {
    if (fields === undefined || fields === null) {
      throw new BadRequestException(
        `\`fields\` is required: list the fields to ${action}, e.g. ["name","email"]`,
      );
    }
    return fields;
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof HttpException) {
    const res = e.getResponse();
    const msg =
      typeof res === 'string' ? res : (res as { message?: unknown }).message;
    return Array.isArray(msg) ? msg.join('; ') : String(msg ?? e.message);
  }
  return 'Internal server error';
}

function httpErrorBody(e: HttpException): unknown {
  const res = e.getResponse();
  return typeof res === 'string'
    ? { statusCode: e.getStatus(), message: res }
    : res;
}

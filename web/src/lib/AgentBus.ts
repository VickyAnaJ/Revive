import type { ZodSchema } from 'zod';
import { repairJson } from './jsonRepair';

export type AgentName = 'patient' | 'coach' | 'scenario';

export type AgentCall = () => Promise<string>;

export interface CallOptions<T> {
  agent: AgentName;
  schema: ZodSchema<T>;
  performCall: AgentCall;
  fallback: () => T;
  correlationId?: string;
}

export interface AgentBusConfig {
  maxAttempts?: number;
  baseBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CallStats {
  attempts: number;
  repairedJson: boolean;
  fellBack: boolean;
}

export class AgentBus {
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly stats: Record<AgentName, CallStats> = {
    patient: { attempts: 0, repairedJson: false, fellBack: false },
    coach: { attempts: 0, repairedJson: false, fellBack: false },
    scenario: { attempts: 0, repairedJson: false, fellBack: false },
  };

  constructor(config: AgentBusConfig = {}) {
    this.maxAttempts = config.maxAttempts ?? 3;
    this.baseBackoffMs = config.baseBackoffMs ?? 200;
    this.sleep =
      config.sleep ??
      ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  }

  async call<T>(options: CallOptions<T>): Promise<T> {
    const correlationId = options.correlationId ?? mintCorrelationId();
    const slot = this.stats[options.agent];
    slot.attempts = 0;
    slot.repairedJson = false;
    slot.fellBack = false;

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      slot.attempts = attempt;
      const start = Date.now();
      try {
        const raw = await options.performCall();
        const result = this.parseAndValidate(raw, options.schema, slot);
        const latency = Date.now() - start;
        console.info(
          `[C5d] call=${options.agent} attempt=${attempt}/${this.maxAttempts} outcome=ok latency=${latency}ms cid=${correlationId}`,
        );
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const latency = Date.now() - start;
        console.warn(
          `[C5d] call=${options.agent} attempt=${attempt}/${this.maxAttempts} outcome=error latency=${latency}ms cid=${correlationId} reason=${lastError.message}`,
        );
      }

      if (attempt < this.maxAttempts) {
        const backoff = this.baseBackoffMs * 2 ** (attempt - 1);
        await this.sleep(backoff);
      }
    }

    slot.fellBack = true;
    console.warn(
      `[C5d] call=${options.agent} cascade=exhausted falling_back cid=${correlationId} last_error=${lastError?.message ?? 'unknown'}`,
    );
    return options.fallback();
  }

  getStats(agent: AgentName): CallStats {
    return { ...this.stats[agent] };
  }

  private parseAndValidate<T>(
    raw: string,
    schema: ZodSchema<T>,
    slot: CallStats,
  ): T {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const repaired = repairJson(raw);
      slot.repairedJson = true;
      try {
        parsed = JSON.parse(repaired);
      } catch (err) {
        throw new Error(
          `JSON unparseable after repair: ${(err as Error).message}`,
        );
      }
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Schema rejected response: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      );
    }
    return result.data;
  }
}

function mintCorrelationId(): string {
  return Math.random().toString(36).slice(2, 10);
}

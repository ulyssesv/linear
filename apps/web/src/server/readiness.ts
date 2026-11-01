// Readiness registry (SEED-R20). A check passes by resolving and fails by throwing or by not
// answering within the timeout. The seed registers none; the planning sheet adds the database.

export type ReadinessCheck = () => void | Promise<void>;

export type CheckResult = { status: "ok" } | { status: "fail"; error: string };

export type ReadinessReport = {
  ok: boolean;
  checks: Record<string, CheckResult>;
};

export type ReadinessRegistry = {
  register(name: string, check: ReadinessCheck): void;
  run(options?: { timeoutMs?: number }): Promise<ReadinessReport>;
};

export const defaultTimeoutMs = 2000;

async function runOne(check: ReadinessCheck, timeoutMs: number): Promise<CheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    await Promise.race([Promise.resolve().then(check), timeout]);
    return { status: "ok" };
  } catch (error) {
    return { status: "fail", error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export function createReadinessRegistry(): ReadinessRegistry {
  const checks = new Map<string, ReadinessCheck>();
  return {
    register(name, check) {
      if (checks.has(name)) throw new Error(`readiness check "${name}" is already registered`);
      checks.set(name, check);
    },
    async run({ timeoutMs = defaultTimeoutMs } = {}) {
      const entries = [...checks];
      const results = await Promise.all(entries.map(([, check]) => runOne(check, timeoutMs)));
      const report: ReadinessReport = { ok: true, checks: {} };
      entries.forEach(([name], i) => {
        const result = results[i] as CheckResult;
        report.checks[name] = result;
        if (result.status === "fail") report.ok = false;
      });
      return report;
    },
  };
}

/** The process-wide registry that /readyz reports on. */
export const readiness = createReadinessRegistry();

export function registerReadinessCheck(name: string, check: ReadinessCheck): void {
  readiness.register(name, check);
}

// The Linear webhook receiver behind POST /webhooks/linear (MIRROR-R11, MIRROR-R12,
// MIRROR-R14).
//
// For each delivery, in order:
// 1. Read the raw body (at most maxBodyBytes) and check `Linear-Signature` against it with
//    LINEAR_WEBHOOK_SECRET. Unsigned or mis-signed: 401, nothing else read.
// 2. Parse it. Not JSON or not a webhook envelope: 400.
// 3. Check the signed `webhookTimestamp` is within a minute of our clock (verify.ts), so a
//    captured delivery cannot be replayed later: 401 otherwise. `Linear-Delivery` must be
//    present: 400 otherwise.
// 4. In one transaction: insert the delivery id into webhook_deliveries if absent, apply
//    the event (dispatch.ts), record the delivery's outcome and one sync-log entry with
//    source `webhook`. A delivery id already there is a retry or a replay of something
//    applied: nothing is written and the answer is 200. A crash rolls everything back, so
//    a delivery is never marked seen without its writes.
// 5. Answer 200, or 500 on a database failure or when the work outlasts the response
//    budget, so that Linear retries; the delivery id keeps the retry from applying twice.
//
// Linear counts a delivery as failed when the answer takes more than five seconds and
// retries it after a minute, an hour and six hours. The budget here is four seconds, and
// each statement is cut at three.
//
// The organization in the payload is not checked: the signing secret belongs to this
// workspace's OAuth app, so a correctly signed delivery comes from it.
//
// Each delivery leaves one structured log line with its outcome and counts (MIRROR-R31).
// The body, the headers and the secret are never logged.
import type { Sql } from "../db/client.ts";
import { recordSyncRun, type WriteContext } from "../mirror/apply.ts";
import { applyEvent, type EventCounts, type EventResult } from "./dispatch.ts";
import { PayloadError, parseEvent, type WebhookEvent } from "./payload.ts";
import { signatureMatches, timestampFresh } from "./verify.ts";

export type ReceiveOptions = {
  /** Opens the database, called once the delivery is verified; a throw answers 500. */
  database: () => Sql;
  /** LINEAR_WEBHOOK_SECRET. Without it every delivery is refused. */
  secret: string | undefined;
  /** Epoch milliseconds. */
  now?: () => number;
  log?: (line: string) => void;
  /** How long the receiver may work before answering 500. */
  budgetMs?: number;
  maxBodyBytes?: number;
};

/** Under Linear's five seconds, with room for the network. */
export const responseBudgetMs = 4_000;
const statementTimeoutMs = 3_000;
/** Linear's payloads are a few kilobytes; a project with a long description stays far below. */
export const maxBodyBytes = 1024 * 1024;

export type DeliveryOutcome =
  | "applied"
  | "dropped"
  | "ignored"
  | "duplicate"
  | "unauthorized"
  | "stale"
  | "invalid"
  | "too-large"
  | "failed"
  | "timeout"
  | "misconfigured";

type LogFields = {
  delivery: string | null;
  type?: string;
  action?: string;
  entity?: string | null;
  outcome: DeliveryOutcome;
  status: number;
  changed?: number;
  counts?: EventCounts;
  error?: string;
};

const headers = { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" };
const statusText: Record<number, string> = {
  200: "ok",
  400: "bad request",
  401: "unauthorized",
  405: "method not allowed",
  413: "payload too large",
  500: "error",
};

class Timeout extends Error {}

type Processed = { duplicate: true } | ({ duplicate: false } & EventResult);

/** Answers one delivery. Never throws. */
export async function receiveLinearWebhook(
  request: Request,
  options: ReceiveOptions,
): Promise<Response> {
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.log(line));
  const started = now();
  const delivery = request.headers.get("linear-delivery");

  const answer = (fields: LogFields): Response => {
    log(
      JSON.stringify({
        event: "linear-webhook",
        ...fields,
        delivery: fields.delivery ?? delivery,
        ms: Math.max(0, now() - started),
      }),
    );
    return new Response(statusText[fields.status] ?? "", { status: fields.status, headers });
  };

  if (request.method !== "POST") return answer({ delivery, outcome: "invalid", status: 405 });
  if (!options.secret) {
    return answer({ delivery, outcome: "misconfigured", status: 500, error: "no signing secret" });
  }
  const limit = options.maxBodyBytes ?? maxBodyBytes;
  if (Number(request.headers.get("content-length") ?? 0) > limit) {
    return answer({ delivery, outcome: "too-large", status: 413 });
  }
  let body: Uint8Array;
  try {
    body = new Uint8Array(await request.arrayBuffer());
  } catch {
    return answer({ delivery, outcome: "invalid", status: 400 });
  }
  if (body.byteLength > limit) return answer({ delivery, outcome: "too-large", status: 413 });

  if (!signatureMatches(body, request.headers.get("linear-signature"), options.secret)) {
    return answer({ delivery, outcome: "unauthorized", status: 401 });
  }
  let event: WebhookEvent;
  try {
    event = parseEvent(new TextDecoder().decode(body));
  } catch {
    return answer({ delivery, outcome: "invalid", status: 400 });
  }
  const described = { delivery, type: event.type, action: event.action };
  if (!timestampFresh(event.webhookTimestamp, now())) {
    return answer({ ...described, outcome: "stale", status: 401 });
  }
  if (!delivery) {
    return answer({ ...described, outcome: "invalid", status: 400, error: "no delivery id" });
  }

  let sql: Sql;
  try {
    sql = options.database();
  } catch (error) {
    return answer({ ...described, outcome: "misconfigured", status: 500, error: message(error) });
  }

  const budget = options.budgetMs ?? responseBudgetMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Timeout()), budget);
  });
  try {
    const processed = await Promise.race([
      processDelivery(sql, delivery, event, () => new Date(now())),
      deadline,
    ]);
    if (processed.duplicate) return answer({ ...described, outcome: "duplicate", status: 200 });
    return answer({
      ...described,
      entity: processed.entityId,
      outcome: processed.outcome,
      status: 200,
      changed: processed.changed,
      counts: processed.counts,
    });
  } catch (error) {
    if (error instanceof PayloadError) {
      return answer({ ...described, outcome: "invalid", status: 400, error: error.message });
    }
    if (error instanceof Timeout) {
      return answer({ ...described, outcome: "timeout", status: 500 });
    }
    // Best effort, and bounded: the sync status should show that webhooks are failing.
    await Promise.race([
      recordSyncRun(sql, {
        source: "webhook",
        startedAt: new Date(started),
        finishedAt: new Date(now()),
        outcome: "failed",
        changed: 0,
        counts: { delivery, type: event.type, action: event.action },
        error: message(error).slice(0, 1000),
      }).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]);
    return answer({ ...described, outcome: "failed", status: 500, error: message(error) });
  } finally {
    clearTimeout(timer);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Dedupes and applies one delivery in a single transaction. */
async function processDelivery(
  sql: Sql,
  delivery: string,
  event: WebhookEvent,
  clock: () => Date,
): Promise<Processed> {
  const startedAt = clock();
  return (await sql.begin(async (tx) => {
    await tx.unsafe(`set local statement_timeout = ${statementTimeoutMs}`);
    const [fresh] = await tx`
      insert into webhook_deliveries (delivery_id, received_at, type, action, outcome)
      values (${delivery}, ${startedAt}, ${event.type}, ${event.action}, 'ignored')
      on conflict (delivery_id) do nothing
      returning delivery_id
    `;
    if (!fresh) return { duplicate: true };

    const context: WriteContext = { source: "webhook", at: clock() };
    const result = await applyEvent(tx, event, context);
    await tx`
      update webhook_deliveries
      set outcome = ${result.outcome}, entity_id = ${result.entityId}, changed = ${result.changed}
      where delivery_id = ${delivery}
    `;
    await recordSyncRun(tx, {
      source: "webhook",
      startedAt,
      finishedAt: clock(),
      outcome: "ok",
      changed: result.changed,
      counts: {
        delivery,
        type: event.type,
        action: event.action,
        entity: result.entityId,
        outcome: result.outcome,
        ...result.counts,
      },
    });
    return { duplicate: false, ...result };
  })) as Processed;
}

/** Deletes delivery records older than `before`; dedup only needs Linear's retry horizon. */
export async function pruneDeliveries(sql: Sql, before: Date): Promise<number> {
  const rows = await sql`
    delete from webhook_deliveries where received_at < ${before} returning delivery_id
  `;
  return rows.length;
}

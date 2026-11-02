-- Webhook deliveries from Linear (MIRROR-R11, MIRROR-R14).
--
-- One row per delivery the receiver accepted, keyed by Linear's delivery id (the
-- Linear-Delivery header, a UUID that a retry of the same delivery keeps). The receiver
-- inserts the row in the same transaction as the mirror writes the delivery causes, so a
-- delivery is recorded exactly when its writes are committed; a second delivery with the
-- same id finds the row and is ignored. Written by src/server/webhooks/receive.ts only.
--
-- outcome:
--   applied  a supported event, applied to the mirror (`changed` may still be 0)
--   dropped  a supported event for an entity outside the mirror's scope (MIRROR-R12)
--   ignored  an event type or action the mirror does not follow
--
-- Rows only need to outlive Linear's retries (the last one comes about six hours after the
-- first attempt); older rows may be pruned.

create table webhook_deliveries (
  delivery_id text primary key,
  received_at timestamptz not null,
  type text not null,
  action text not null,
  entity_id text,
  outcome text not null check (outcome in ('applied', 'dropped', 'ignored')),
  changed integer not null default 0
);

create index webhook_deliveries_received_at on webhook_deliveries (received_at);

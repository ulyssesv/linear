-- The workspace mirror (MIRROR-R9, MIRROR-R10, MIRROR-R12, MIRROR-R14).
--
-- A read model of public-team data from Linear. Only src/server/mirror/apply.ts writes
-- these tables (a test enforces it); everything else reads them through
-- src/server/mirror/read.ts.
--
-- Every entity table carries the same bookkeeping columns:
--   updated_at     when Linear last changed the entity; an older payload never overwrites
--                  a newer row
--   archived_at    when Linear archived it, null when it is not archived
--   removed_at     when the mirror learned Linear no longer returns it; a flag, never a
--                  delete, so later sheets keep stable references
--   synced_at      when the mirror last wrote the row
--   synced_source  which feeder wrote it: bootstrap, webhook or reconcile
--   sync_seq       increases on every write, so a reader can ask what changed since
--
-- References between entities are plain ids without foreign keys: feeders apply entity
-- types in any order, and a reference to something outside the mirror (a private team, a
-- removed label) simply finds nothing when joined.

create sequence mirror_sync_seq;

create table mirror_teams (
  id text primary key,
  name text not null,
  key text not null,
  display_name text not null,
  parent_id text,
  -- The scope filter drops private teams before any write; the database refuses them too.
  private boolean not null default false check (not private),
  updated_at timestamptz not null,
  archived_at timestamptz,
  removed_at timestamptz,
  synced_at timestamptz not null,
  synced_source text not null check (synced_source in ('bootstrap', 'webhook', 'reconcile')),
  sync_seq bigint not null default nextval('mirror_sync_seq')
);

create table mirror_users (
  id text primary key,
  name text not null,
  display_name text not null,
  email text not null,
  avatar_url text,
  active boolean not null,
  updated_at timestamptz not null,
  archived_at timestamptz,
  removed_at timestamptz,
  synced_at timestamptz not null,
  synced_source text not null check (synced_source in ('bootstrap', 'webhook', 'reconcile')),
  sync_seq bigint not null default nextval('mirror_sync_seq')
);

create table mirror_project_statuses (
  id text primary key,
  name text not null,
  -- backlog, planned, started, paused, completed, canceled
  type text not null,
  color text not null,
  position double precision not null,
  updated_at timestamptz not null,
  archived_at timestamptz,
  removed_at timestamptz,
  synced_at timestamptz not null,
  synced_source text not null check (synced_source in ('bootstrap', 'webhook', 'reconcile')),
  sync_seq bigint not null default nextval('mirror_sync_seq')
);

-- Initiative statuses are a fixed enum in Linear's schema (Proposed, Planned, Active,
-- Completed, Canceled), not entities with their own query. The bootstrap writes them from
-- that list, so the sheet reads every reference type the same way.
create table mirror_initiative_statuses (
  id text primary key,
  name text not null,
  position integer not null,
  updated_at timestamptz not null,
  archived_at timestamptz,
  removed_at timestamptz,
  synced_at timestamptz not null,
  synced_source text not null check (synced_source in ('bootstrap', 'webhook', 'reconcile')),
  sync_seq bigint not null default nextval('mirror_sync_seq')
);

-- Labels and label groups share a table, as in Linear: a group is a label with is_group,
-- and a label in a group names it as parent_id. `selection` is 'single' or 'multi' for a
-- group (Linear treats a group without a type as single-select) and null for a label.
create table mirror_project_labels (
  id text primary key,
  name text not null,
  color text not null,
  is_group boolean not null,
  selection text check (selection in ('single', 'multi')),
  parent_id text,
  -- The team a team-scoped label belongs to; null for a workspace label.
  team_id text,
  updated_at timestamptz not null,
  archived_at timestamptz,
  removed_at timestamptz,
  synced_at timestamptz not null,
  synced_source text not null check (synced_source in ('bootstrap', 'webhook', 'reconcile')),
  sync_seq bigint not null default nextval('mirror_sync_seq'),
  check ((selection is not null) = is_group)
);

create table mirror_initiative_labels (
  id text primary key,
  name text not null,
  color text not null,
  is_group boolean not null,
  selection text check (selection in ('single', 'multi')),
  parent_id text,
  updated_at timestamptz not null,
  archived_at timestamptz,
  removed_at timestamptz,
  synced_at timestamptz not null,
  synced_source text not null check (synced_source in ('bootstrap', 'webhook', 'reconcile')),
  sync_seq bigint not null default nextval('mirror_sync_seq'),
  check ((selection is not null) = is_group)
);

create table mirror_projects (
  id text primary key,
  name text not null,
  slug_id text not null,
  -- Linear's human-readable identifier (P-KEY-12); null for legacy projects.
  identifier text,
  url text not null,
  status_id text,
  lead_id text,
  start_date date,
  target_date date,
  -- 0 none, 1 urgent, 2 high, 3 medium, 4 low
  priority integer not null,
  -- onTrack, atRisk, offTrack
  health text,
  -- 0 to 1
  progress double precision not null,
  -- Public teams only: the scope filter strips private team ids before any write.
  team_ids text[] not null,
  initiative_ids text[] not null,
  label_ids text[] not null,
  last_update_id text,
  last_update_excerpt text,
  last_update_health text,
  last_update_at timestamptz,
  created_at timestamptz not null,
  completed_at timestamptz,
  canceled_at timestamptz,
  updated_at timestamptz not null,
  archived_at timestamptz,
  removed_at timestamptz,
  synced_at timestamptz not null,
  synced_source text not null check (synced_source in ('bootstrap', 'webhook', 'reconcile')),
  sync_seq bigint not null default nextval('mirror_sync_seq'),
  check (cardinality(team_ids) > 0)
);

create table mirror_initiatives (
  id text primary key,
  name text not null,
  slug_id text not null,
  identifier text,
  url text not null,
  -- Proposed, Planned, Active, Completed, Canceled (mirror_initiative_statuses.id)
  status text not null,
  owner_id text,
  lead_team_id text,
  target_date date,
  priority integer not null,
  health text,
  project_ids text[] not null,
  label_ids text[] not null,
  last_update_id text,
  last_update_excerpt text,
  last_update_health text,
  last_update_at timestamptz,
  created_at timestamptz not null,
  completed_at timestamptz,
  updated_at timestamptz not null,
  archived_at timestamptz,
  removed_at timestamptz,
  synced_at timestamptz not null,
  synced_source text not null check (synced_source in ('bootstrap', 'webhook', 'reconcile')),
  sync_seq bigint not null default nextval('mirror_sync_seq')
);

create index mirror_teams_sync_seq on mirror_teams (sync_seq);
create index mirror_users_sync_seq on mirror_users (sync_seq);
create index mirror_project_statuses_sync_seq on mirror_project_statuses (sync_seq);
create index mirror_initiative_statuses_sync_seq on mirror_initiative_statuses (sync_seq);
create index mirror_project_labels_sync_seq on mirror_project_labels (sync_seq);
create index mirror_initiative_labels_sync_seq on mirror_initiative_labels (sync_seq);
create index mirror_projects_sync_seq on mirror_projects (sync_seq);
create index mirror_initiatives_sync_seq on mirror_initiatives (sync_seq);

-- One row per feeder run: a bootstrap, a reconcile pass, a webhook delivery (MIRROR-R14).
-- `changed` counts the rows the run inserted, updated or flagged removed; `counts` breaks
-- them down per entity type.
create table mirror_sync_log (
  id bigserial primary key,
  source text not null check (source in ('bootstrap', 'webhook', 'reconcile')),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  outcome text not null check (outcome in ('ok', 'failed')),
  changed integer not null default 0,
  counts jsonb not null default '{}',
  error text
);

create index mirror_sync_log_source_finished on mirror_sync_log (source, finished_at desc);
create index mirror_sync_log_changed on mirror_sync_log (finished_at desc) where changed > 0;

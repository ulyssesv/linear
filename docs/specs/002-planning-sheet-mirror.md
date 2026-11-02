---
id: MIRROR
title: Workspace mirror and read-only sheet
status: draft
area: planning-sheet
linear:
  initiative: https://linear.app/sesv/initiative/planning-sheet-7f1a80410512
  parent: https://linear.app/sesv/project/workspace-mirror-and-read-only-sheet-55cadea80f8b
  document: https://linear.app/sesv/document/spec-002-workspace-mirror-and-read-only-sheet-674d255000f2
supersedes: []
created: 2026-11-02
---

# MIRROR: Workspace mirror and read-only sheet

## 1. Context

Managers who plan quarterly still do the exercise in a spreadsheet and then transcribe
the result into Linear. The planning sheet tests whether a spreadsheet-like surface over
Linear projects and initiatives, with edits flowing back to Linear, beats both a plain
export and Linear's own views. The hypothesis: a grid that feels like a spreadsheet
(keyboard navigation, paste, fill, free columns, formulas) but whose rows are real Linear
entities lets a planning team arrange, annotate and compare plans faster than a detached
sheet, without losing Linear as the source of truth.

The work is split into four projects under the Planning Sheet initiative, each shipped
to https://linear.sesv.co and verifiable by hand there:

| | Project | Delivers |
|---|---|---|
| P1 | [Workspace mirror and read-only sheet](https://linear.app/sesv/project/workspace-mirror-and-read-only-sheet-55cadea80f8b) | This spec: Linear app, database, mirror, login, two read-only sheets |
| P2 | [Sheet document and commit to Linear](https://linear.app/sesv/project/sheet-document-and-commit-to-linear-210bb43e7d33) | Sheets as documents, staged edits, commit under each author's name, draft rows |
| P3 | [Live multi-user editing](https://linear.app/sesv/project/live-multi-user-editing-be8d40517109) | Electric, optimistic edits, cell-level conflicts, history and undo |
| P4 | [Formulas and snapshots](https://linear.app/sesv/project/formulas-and-snapshots-6fdf24d4056d) | Formula columns, snapshots with three-way diff and apply |

This spec is P1: the data foundation and the first grid. It takes the domain model of
the pre-repository draft of 2026-10-28 (a mirror of the workspace as a read model, a
sheet document on top, Linear as the source of truth for linked values) and ships the
read side of it. Everything the later projects need from the data layer, including
Postgres configured for logical replication, lands here so that P2 and P3 add
behaviour rather than restructure.

Decisions taken while shaping this spec are recorded in REC-004 and REC-005.

## 2. Goals and non-goals

Goals:

- A Linear OAuth app for the workspace, used as the central identity for reading and as
  the login for users.
- A database behind the site, with migrations applied by the image's `migrate` command
  and reported by `/readyz`.
- A mirror of the workspace's public-team projects and initiatives and their reference
  data, filled by a bootstrap, kept current by webhooks within seconds, and bounded in
  staleness by a scheduled reconcile run by the image's `scheduler` command.
- Sign in with Linear, restricted to members of the workspace, with per-user tokens kept
  for later attribution.
- Two read-only sheets, projects and initiatives, with the linked columns, behind login,
  on a grid that sits behind an adapter boundary.
- Fixtures large enough to exercise hundreds of rows, sub-teams and a private team.

Non-goals, deferred to the project named:

- Any write to Linear, staged edits, dirty state, commit, draft rows (P2).
- Sheets as saved documents, free columns, column groups, manual row order (P2).
- Electric, live multi-user editing, history, undo (P3).
- Formulas, snapshots (P4).
- Issues in any role, cycles, capacity, private-team data, Linear's permission model
  inside the app, mobile, offline (out of scope for the planning sheet as a whole).
- A sheet filter that persists; in P1 filters are view-level and forgotten on reload.

## 3. Requirements

### Linear app and identities

- **MIRROR-R1** (manual) A Linear OAuth app exists for the workspace with client
  credentials and webhooks enabled. Its client id, client secret and webhook signing
  secret reach the server through the environment; nothing else holds them.
- **MIRROR-R2** (unit) The server reads the workspace with a client-credentials token of
  the OAuth app (an app actor scoped to public teams), caches it until shortly before it
  expires, and requests a new one on expiry or on an authentication failure. No personal
  API key is used at runtime.
- **MIRROR-R3** (unit) Every absolute URL the server gives to Linear, the OAuth redirect
  and the webhook endpoint, derives from `PUBLIC_URL`, never from an incoming request.
- **MIRROR-R4** (unit) Calls to Linear back off on rate limiting, honouring the wait the
  response asks for, and a bootstrap of the fixture workspace completes within Linear's
  hourly budget for one app actor.

### Database and commands

- **MIRROR-R5** (e2e) The image's `migrate` command applies the pending schema
  migrations to the configured database and exits 0; it exits non-zero on failure and
  is safe to run again. The reserved behaviour of SEED-R24 ends for this command.
- **MIRROR-R6** (unit) `/readyz` registers a database check that fails when the database
  cannot be reached, so the pod is not ready without it.
- **MIRROR-R7** (unit) The environment schema gains the database connection, the OAuth
  client credentials, the webhook signing secret, the session secret, the token
  encryption key and an optional sign-in allowlist. `serve`, `migrate` and `scheduler`
  exit non-zero at startup listing what is missing or invalid, each requiring only what
  it uses. `docs/deploy.md` lists the names.
- **MIRROR-R8** (check) Local development runs the database from a compose file, and CI
  runs the unit and end-to-end tests against a database service, so no test needs a
  developer's own database.

### Mirror

- **MIRROR-R9** (unit) The mirror holds teams (with parent team and private flag), users,
  project statuses, initiative statuses, project labels and label groups, initiative
  labels, projects and initiatives with the fields in section 4, and for every entity the
  time Linear last changed it and whether it is archived. Nothing but the sync code
  writes to the mirror.
- **MIRROR-R10** (unit) A bootstrap fills an empty mirror by paging through every entity
  type. Running it again on a filled mirror changes nothing except entities that changed
  in Linear, and flags entities Linear no longer returns as removed rather than deleting
  them.
- **MIRROR-R11** (unit) The webhook endpoint verifies the signature and rejects anything
  unsigned or mis-signed, ignores a delivery it has already applied, answers within
  Linear's response budget, and applies create, update and remove events for projects,
  project updates, initiatives and initiative updates to the mirror.
- **MIRROR-R12** (unit) The mirror never contains a private team, nor a project or
  initiative visible only through private teams. Inbound events and listing results for
  such entities are dropped before any write, as a second line behind the token scope.
- **MIRROR-R13** (unit) A reconcile pass applies every entity changed in Linear since the
  last successful pass, with enough overlap to cover a missed webhook, and records when
  it ran. The image's `scheduler` command runs one pass and exits 0, or exits non-zero
  on failure, so a CronJob reports the truth. The reserved behaviour of SEED-R24 ends
  for this command.
- **MIRROR-R14** (unit) Every applied change records its source (bootstrap, webhook,
  reconcile) and time, and the server can report when the mirror last changed and when
  webhooks and reconcile last ran.

### Login

- **MIRROR-R15** (e2e) Sheet routes require a signed-in user and send anyone else to a
  sign-in page. The landing page, `/healthz` and `/readyz` stay public.
- **MIRROR-R16** (unit) Sign-in is Linear OAuth acting as the user. It is accepted only
  when the user belongs to the workspace the OAuth app is installed in and, when an
  allowlist is configured, when their email is on it. Anyone else is refused with a
  message and gets no session.
- **MIRROR-R17** (unit) Per-user access and refresh tokens are stored encrypted at rest,
  refreshed server-side, and never sent to the browser. Secrets and tokens never appear
  in logs. Sessions expire after inactivity and sign-out ends the session.

### Sheets

- **MIRROR-R18** (e2e) Two sheets, projects and initiatives, list every mirrored entity of
  that kind. Archived and removed entities are hidden by default, shown on request, and
  visibly flagged.
- **MIRROR-R19** (e2e) Each sheet shows the columns of section 4 with the editor shape
  named there. No cell can be edited; the grid gives no editing affordance.
- **MIRROR-R20** (e2e) View-level sort, filter by team and by status, and column hide
  work in the browser, persist nothing, and write nowhere.
- **MIRROR-R21** (manual) Keyboard navigation (arrows, Tab, Home, End, page keys), column
  resize, column reorder and a frozen first column work as in a spreadsheet.
- **MIRROR-R22** (check) Exactly one module imports the grid library. A check fails the
  build when any other file does.
- **MIRROR-R23** (e2e) The sheet routes are rendered on the client only and say so when
  JavaScript is off; every other route keeps server rendering (SEED-R18).
- **MIRROR-R24** (e2e) An open sheet shows when the mirror last changed, and a change
  made in Linear reaches an open sheet without reload within ten seconds of the server
  applying it, whether by webhook or by reconcile.
- **MIRROR-R25** (manual) A sheet of three hundred projects loads in under two seconds
  on the production host and scrolls without jank.
- **MIRROR-R26** (e2e) The landing page card for the planning sheet reads "In progress"
  and links to the sheets.

### Fixtures

- **MIRROR-R27** (unit) A repository tool seeds, under the `Test` team hierarchy, at least
  three hundred projects and sixty initiatives spanning every status, several leads,
  dates, priorities and labels, including projects in sub-teams and in several teams.
  Running it again updates rather than duplicates, and it never touches an entity
  outside that hierarchy. `--dry-run` prints the plan and writes nothing.
- **MIRROR-R28** (manual) A private team with at least one project exists in the
  workspace, and neither appears in the mirror or the sheets.

### Delivery and operations

- **MIRROR-R29** (manual) `docs/deploy.md` describes the database the image needs
  (version, logical replication enabled from the start for P3, a direct connection),
  the new environment names, the migration Job to run before each rollout, the CronJob
  for `scheduler` with a suggested schedule, the webhook and OAuth callback paths to
  expose, and the resource hints revised with the database in play.
- **MIRROR-R30** (check) The container smoke still passes under the production security
  flags, including `migrate` and `scheduler` against a throwaway database.
- **MIRROR-R31** (manual) Each webhook delivery and each reconcile pass leaves one
  structured log line with its outcome and counts, enough to tell from logs alone why
  the mirror is stale.

## 4. Linked fields

The columns of the two sheets. "Shape" is how the cell renders in P1 and what editor P2
attaches. "P2 writable" is recorded now so the mirror carries what P2 will need.

Projects:

| Field | Shape | P2 writable |
|---|---|---|
| name | text | yes |
| status | badge from the lead team's project statuses | yes |
| lead | user | yes |
| start date, target date | date | yes |
| priority | badge | yes |
| one column per single-select project label group | badge | yes |
| teams | chips | no |
| initiatives | chips | no |
| health | badge | no |
| progress | percent | no |
| latest update | excerpt with date | no |
| identifier, link to Linear | link | no |

Initiatives:

| Field | Shape | P2 writable |
|---|---|---|
| name | text | yes |
| status | badge | yes |
| owner | user | yes |
| target date | date | yes |
| priority | badge | yes |
| one column per single-select initiative label group | badge | yes |
| lead team | chip | no |
| health | badge | no |
| project count | number | no |
| latest update | excerpt with date | no |
| identifier, link to Linear | link | no |

Multi-select label groups, descriptions, milestones and members are not shown in P1.

## 5. Design notes

Mirror as a read model. The mirror is a plain copy of public-team data from Linear,
owned by the sync code and read by everything else. Dirty and conflict state in P2 are
derived by comparing a staged value with the mirror value, which only works if the
mirror is never written by anything but sync. Three feeders keep it current: bootstrap
for the first fill and on demand, webhooks for latency, reconcile for completeness.
Removal is a flag, not a delete, so later sheets, formulas and snapshots keep stable
references.

Identities. The OAuth app serves two roles. Its client-credentials token is the central
identity: scoped by Linear itself to public teams, so the privacy boundary is Linear's
before it is ours. The same app signs users in; the token Linear returns names the
user's workspace, which is how a user from another workspace is refused without any
workspace setting of our own. Per-user tokens are stored now, unused until P2 pushes
changes under each author's name. The client-credentials token can also replace the
personal key CI uses for `linear:sync`, closing the seed spec's first open question.

Commands as one-shot jobs. `migrate` runs before each rollout as a Job; `scheduler`
runs one reconcile pass and exits, so a CronJob's own history shows every pass and its
outcome. P2 adds the outbox flush to the same pass. Nothing long-running is added to the
image beyond the web server.

Grid behind an adapter. One module translates sheet state into grid configuration and
grid events into intents; it is the only importer of the grid library (REC-004). In P1
the intents are view-only: sort, filter, hide, resize, reorder. P2 adds edit, paste and
fill intents to the same boundary. Replacing the grid later means a new adapter and
theme, nothing else.

Freshness. P1 has no Electric. The client learns that the mirror changed through a
lightweight channel chosen at implementation and refetches the rows that changed; P3
replaces this channel with Electric shapes for sheet data. The ten-second bound is the
requirement; the channel is not.

Sheet routes on the client. The grid needs the browser; the sheet routes opt out of
server rendering individually, as the seed spec planned. The shell around them (header,
footer, sign-in state) stays server-rendered so the site keeps working without
JavaScript everywhere else.

Fixtures. The `Test` team and its three sub-teams exist for this. Seeding there keeps
the real initiatives clean, and sub-teams exercise team hierarchy, which the earlier
draft's model lacked. The private team is created by hand because the seed tool must
never create or alter teams.

Environment and secrets. New names arrive with this spec and are added to
`docs/deploy.md` in the same pull request, per the existing contract. Infra holds the
values as sops secrets. The database is provisioned with logical replication from the
start so P3 adds Electric without a database change.

## 6. Validation

- Unit (Vitest): token acquisition and renewal, URL derivation, back-off, environment
  schema, mirror upserts from recorded Linear payloads, bootstrap idempotence, webhook
  signature and deduplication, scope filter, reconcile window, sync log, sign-in
  acceptance rules, token encryption, seed tool planning against a mocked client.
- End to end (Playwright, `local` project, against a database service): `migrate`,
  public and protected routes, both sheets with their columns, sort and filter, archived
  toggle, client-only rendering, the freshness indicator and an in-place update driven
  by a simulated webhook, the landing card.
- Checks: single grid importer, compose and CI database service, container smoke with
  `migrate` and `scheduler`.
- Manual: the OAuth app, the private team, keyboard and column behaviours, the
  performance bound, `docs/deploy.md`, log lines, and the acceptance for the whole spec:
  sign in at https://linear.sesv.co, open the projects sheet, change a project in Linear
  and watch the row update; disable the webhook, change another, and watch the next
  reconcile catch it; confirm the private team's project never appears.

Order of work. Database and commands first, then identities, then the mirror feeders,
then login, then the sheets, then fixtures and the hand-off. Each task follows
red-green-refactor with tests that cite the requirement ids.

## 7. Tasks

- [ ] T1 Database, migrations, `migrate` command, readiness check, compose file and CI
      database service (R5, R6, R8, R30)
- [ ] T2 Linear OAuth app by hand, environment schema, central identity token and
      rate-limit back-off (R1, R2, R3, R4, R7)
- [ ] T3 Mirror model, bootstrap, scope filter and sync log (R9, R10, R12, R14)
- [ ] T4 Webhook receiver (R11, R12, R14)
- [ ] T5 Reconcile pass and `scheduler` command (R13, R14)
- [ ] T6 Sign in with Linear, sessions, allowlist, encrypted token storage (R15, R16, R17)
- [ ] T7 Grid adapter and the projects and initiatives sheets (R18, R19, R22, R23)
- [ ] T8 Sheet behaviours: sort, filter, hide, keyboard, freeze, archived flag, freshness
      and in-place updates (R20, R21, R24, R25)
- [ ] T9 Fixture seed tool and the private team (R27, R28)
- [ ] T10 Deploy hand-off, landing card, log lines, first release and rollout
      verification (R26, R29, R31)

## 8. Open questions

1. Reconcile cadence: every ten minutes is the starting suggestion in `docs/deploy.md`;
   the bound on staleness is the interval, so the author picks it with infra.
2. Which single-select label groups exist in the fixture workspace, and whether each
   becomes a column automatically or on request. P1 shows all of them; revisit in P2
   when they become writable.
3. Whether `linear:sync` in CI moves to the OAuth app's client credentials in this
   project or in a site-platform follow-up.

## 9. Decisions

- REC-004 Grid: Handsontable behind an adapter, under the non-commercial license.
- REC-005 Linear identities are the OAuth app's client credentials for the mirror and
  sign in with Linear for users.
- REC-002 stands for hosting; this spec adds the database and the CronJob to the infra
  hand-off and prepares for Electric in P3.

## 10. References

- Linear OAuth 2.0, client credentials: https://linear.app/developers/oauth-2-0-authentication
- Linear webhooks: https://linear.app/developers/webhooks
- Linear rate limits: https://linear.app/developers/rate-limiting
- Linear private teams: https://linear.app/docs/private-teams
- Linear sub-teams: https://linear.app/docs/sub-teams
- Handsontable React: https://handsontable.com/docs/react-data-grid/
- Electric and Postgres logical replication: https://electric-sql.com/docs/guides/deployment

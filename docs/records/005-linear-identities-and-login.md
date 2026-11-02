---
id: REC-005
title: Linear identities are the OAuth app's client credentials for the mirror and sign in with Linear for users
status: accepted
date: 2026-11-02
area: planning-sheet
spec: MIRROR
supersedes: []
linear:
  initiative: https://linear.app/sesv/initiative/planning-sheet-7f1a80410512
  document: https://linear.app/sesv/document/rec-005-linear-identities-are-the-oauth-apps-client-credentials-for-bcd190cf6b88
---

# REC-005: Linear identities are the OAuth app's client credentials for the mirror and sign in with Linear for users

## Context

The planning sheet reads the whole workspace into a mirror and, from P2, writes changes
back that Linear should attribute to the person who made them. The earlier draft
planned an app login with an invite allowlist, a separate "connect Linear" step per
user for attribution, and a central identity that could be either an OAuth app's
client credentials or an admin's personal API key.

Linear's OAuth now offers a client-credentials grant that yields an app actor token
scoped to all public teams and valid for 30 days, with up to a thousand such tokens in
parallel when they share scopes. All OAuth apps use rotating refresh tokens since
2026-04-01. The site is public, so whatever sits behind login must be the only way to
reach workspace data.

## Decision

- One Linear OAuth app, created by hand in the workspace with client credentials and
  webhooks enabled, is the only Linear credential the server holds.
- The mirror reads with the app's client-credentials token: an app actor that Linear
  itself scopes to public teams, renewed on expiry. No personal API key at runtime. The
  app's webhook delivers project, project update, initiative and initiative update
  events, signed with the app's webhook secret.
- Sign in with Linear is the only login. A user is accepted when the token Linear
  returns belongs to the workspace the app is installed in and, when an allowlist is
  configured, their email is on it. No separate app account, password or invite flow.
- Per-user access and refresh tokens are stored encrypted and refreshed server-side
  from the first sign-in, unused until P2 pushes changes under each author's name.
- Every logged-in user sees the same mirror of public-team data. Linear's per-user
  visibility is enforced at write time by Linear, not mirrored in the app.

## Alternatives considered

- Personal API key as central identity. Faster to start and already in CI, but it
  carries the owner's private-team visibility and account lifetime, so the public-team
  boundary would rest on our filter alone.
- App login (invite allowlist) plus a later "connect Linear" step. Two identity systems
  and a second consent screen; login that works while Linear is down is not worth that
  for a tool whose rows are Linear entities.
- Mirroring Linear's visibility per user. Out of scope for the planning sheet; the
  public-team boundary is the privacy model.

## Consequences

- The author creates the OAuth app and hands four secrets to infra: client id, client
  secret, webhook signing secret, and a token encryption key. The session secret is a
  fifth.
- Rotating the app's client secret or requesting different scopes revokes every
  client-credentials token; the server must renew on authentication failure, not only
  on expiry.
- The app token asks for `initiative:read` as well as `read` and `write`: Linear serves
  initiatives and initiative labels to an app actor only with that scope, though its OAuth
  documentation lists no such scope. Sign-in asks users for `read` and `write` only. A
  token saved under an older scope set is not reused; the server requests a new one.
- The seed spec's open question about the CI key can be closed by pointing
  `linear:sync` at the same app's client credentials.
- A user from another workspace who signs in is refused; the workspace is learned from
  the app's own token, so no workspace setting is needed.
- The mirror and the webhook endpoint are only as private as the public-team boundary;
  a private team in the workspace is the fixture that proves it (MIRROR-R28).

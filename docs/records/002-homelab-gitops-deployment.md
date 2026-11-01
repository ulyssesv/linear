---
id: REC-002
title: Deploy to the homelab cluster through the infra repository; this repository ships an image
status: accepted
date: 2026-11-01
area: site-platform
spec: SEED
supersedes: []
linear:
  initiative: https://linear.app/sesv/initiative/site-platform-6ac5ff8c3199
  document: https://linear.app/sesv/document/rec-002-deploy-to-the-homelab-cluster-through-the-infra-repository-d36adbae243d
---

# REC-002: Deploy to the homelab cluster through the infra repository; this repository ships an image

## Context

The planning-sheet draft assumed Railway with TypeScript infrastructure as code.
Railway paused new signups on 22 October 2026 after a security incident and has no
reopening date. Electric Cloud is winding down after Electric joined Databricks, so the
hosted sync fallback is gone too. A single-node Talos cluster exists at home, managed by
a separate `infra` repository through Argo CD, with the rule that no application code
lives there.

## Decision

- Production is the homelab cluster. The infra repository owns the Helm chart, Argo
  Application, Postgres configuration, ingress, DNS and sops-encrypted secret values.
- This repository ships one public container image on GHCR per release tag, plus a
  documented contract: port, probe paths, environment variable names, security context,
  and a single-entrypoint image with `serve`, `scheduler` and `migrate` commands.
- A deploy is two commits: a release tag here that yields an image digest, and a values
  bump in infra that Argo rolls out.
- Hosted fallbacks, in order, if the homelab falls through: Fly.io with Neon via
  Alchemy, then Render Blueprint with Neon.

## Alternatives considered

- Railway with TypeScript IaC. Closed to new accounts.
- Fly.io or Render now. Viable, but the homelab is free, already managed as code, and
  keeps Electric and Postgres in-cluster with logical replication under our control.
- Infrastructure code in this repository. Conflicts with the infra repository's rule
  and would split cluster state across two repositories.

## Consequences

- No pull-request environments. Validation happens in CI against a built server and a
  container, plus a smoke run against production after each deploy.
- The image must satisfy PodSecurity baseline: non-root, no privilege escalation, all
  capabilities dropped, default seccomp, and tolerate a read-only root filesystem.
- Local development needs docker compose for Postgres and Electric once the planning
  sheet starts; the compose file becomes the reference for the Electric version.
- `linear.sesv.co` currently resolves to a private address and must be repointed by
  infra as part of the first deploy.

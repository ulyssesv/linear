// The scope filter (MIRROR-R12): the second line behind the token scope. The app actor's
// token already limits Linear's answers to public teams; this filter drops anything that
// still points only at private teams before it reaches apply.ts. Pure functions over
// normalised records, so the bootstrap, the reconcile pass (T5) and the webhook receiver
// (T4) apply the same rules.
//
// Rules:
// - Teams: a private team is never kept, nor a team below one. A team is kept only when it
//   is not private and its parent, if any, is kept; a parent that is not in the listing
//   counts as private, since the token would have returned a public one.
// - Projects: kept when at least one of their teams is a known public team, with every
//   other team id stripped. A project in public and private teams is visible to the app
//   actor through its public team, so it stays, but the mirror never learns which private
//   teams it is also in. A project in private teams only is dropped.
// - Initiatives: Linear derives an initiative's visibility from its lead team (public when
//   it has none). Kept when the visibility, if the payload carries it, is "public", and the
//   lead team is either absent or a known public team. Its project and label ids stay as
//   Linear gives them; readers join them against the mirror, where private projects never
//   are.
// - Project labels: a label scoped to a team is kept only when that team is a known public
//   team. Workspace labels, initiative labels, users and statuses carry no team and pass.
//
// "Known public team" means a team in the set the caller passes: the teams kept from the
// same listing during a bootstrap, the mirror's teams (read.ts publicTeamIds) for a
// webhook. A team the caller does not know counts as private, so the filter fails closed.
import type {
  Initiative,
  MirrorRecords,
  MirrorType,
  Project,
  ProjectLabel,
  Team,
} from "./types.ts";

export type TeamIds = ReadonlySet<string>;

/** The teams of a listing that may enter the mirror. */
export function scopeTeams(teams: readonly Team[]): Team[] {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const verdicts = new Map<string, boolean>();
  const kept = (team: Team, seen: Set<string>): boolean => {
    const known = verdicts.get(team.id);
    if (known !== undefined) return known;
    let verdict = !team.private;
    if (verdict && team.parentId !== null) {
      const parent = byId.get(team.parentId);
      // A missing parent, or a cycle, fails closed.
      verdict = parent !== undefined && !seen.has(parent.id) && kept(parent, seen.add(team.id));
    }
    verdicts.set(team.id, verdict);
    return verdict;
  };
  return teams.filter((team) => kept(team, new Set()));
}

/** The project with its private team ids stripped, or null when no public team is left. */
export function scopeProject(project: Project, publicTeamIds: TeamIds): Project | null {
  const teamIds = project.teamIds.filter((id) => publicTeamIds.has(id));
  return teamIds.length > 0 ? { ...project, teamIds } : null;
}

/** An initiative as a feeder sees it: `visibility` when the payload carries it. */
export type InitiativeCandidate = Initiative & { visibility?: string | null };

/** The initiative without its visibility, or null when it is not public. */
export function scopeInitiative(
  candidate: InitiativeCandidate,
  publicTeamIds: TeamIds,
): Initiative | null {
  const { visibility, ...initiative } = candidate;
  if (visibility !== undefined && visibility !== null && visibility !== "public") return null;
  if (initiative.leadTeamId !== null && !publicTeamIds.has(initiative.leadTeamId)) return null;
  return initiative;
}

export function scopeProjectLabel(
  label: ProjectLabel,
  publicTeamIds: TeamIds,
): ProjectLabel | null {
  return label.teamId === null || publicTeamIds.has(label.teamId) ? label : null;
}

/** Candidates per type: the record, plus what the filter alone needs. */
export type ScopeCandidates = Omit<MirrorRecords, "initiatives"> & {
  initiatives: InitiativeCandidate;
};

/**
 * The records of one type that may enter the mirror. Teams are filtered on their own
 * (scopeTeams); for every other type `publicTeamIds` are the known public teams.
 */
export function scopeRecords<T extends MirrorType>(
  type: T,
  records: readonly ScopeCandidates[T][],
  publicTeamIds: TeamIds,
): MirrorRecords[T][] {
  const scoped = (record: ScopeCandidates[T]): MirrorRecords[T] | null => {
    switch (type) {
      case "teams": {
        const team = record as Team;
        return (publicTeamIds.has(team.id) && !team.private ? team : null) as MirrorRecords[T];
      }
      case "projects":
        return scopeProject(record as Project, publicTeamIds) as MirrorRecords[T] | null;
      case "initiatives":
        return scopeInitiative(record as InitiativeCandidate, publicTeamIds) as
          | MirrorRecords[T]
          | null;
      case "projectLabels":
        return scopeProjectLabel(record as ProjectLabel, publicTeamIds) as MirrorRecords[T] | null;
      default:
        return record as MirrorRecords[T];
    }
  };
  return records.flatMap((record) => {
    const kept = scoped(record);
    return kept === null ? [] : [kept];
  });
}

import type { Event, Person, State } from "./types";

/** The zero value of the fold: an org that does not exist yet. */
export function emptyState(): State {
  return {
    company: null,
    people: [],
    teams: [],
    memberships: [],
    customers: [],
    assignments: [],
  };
}

/** Replace one person in the roster, leaving everyone else untouched. */
function patchPerson(
  people: Person[],
  personId: string,
  patch: Partial<Person>,
): Person[] {
  return people.map((p) => (p.id === personId ? { ...p, ...patch } : p));
}

/**
 * The single fold step. Pure: returns a new State, never mutates the input.
 * Used three ways — generator bookkeeping, invariant checking, snapshotAt.
 */
export function applyEvent(state: State, event: Event): State {
  switch (event.kind) {
    case "CompanyFounded":
      return {
        ...state,
        company: {
          name: event.name,
          location: event.location,
          foundedAt: event.effectiveDate,
        },
      };

    case "CompanyRelocated":
      return state.company === null
        ? state
        : { ...state, company: { ...state.company, location: event.to } };

    case "PersonHired":
      return {
        ...state,
        people: [
          ...state.people,
          {
            id: event.personId,
            name: event.name,
            role: event.role,
            employmentType: event.employmentType,
            hiredAt: event.effectiveDate,
          },
        ],
        memberships:
          event.teamId === undefined
            ? state.memberships
            : [
                ...state.memberships,
                { personId: event.personId, teamId: event.teamId },
              ],
      };

    // Tombstone, not a delete: the person stays on the roster with a departedAt,
    // and their work is released so orphaned customers become visible.
    case "PersonDeparted":
      return {
        ...state,
        people: patchPerson(state.people, event.personId, {
          departedAt: event.effectiveDate,
        }),
        assignments: state.assignments.filter(
          (a) => a.personId !== event.personId,
        ),
      };

    case "RoleChanged":
      return {
        ...state,
        people: patchPerson(state.people, event.personId, { role: event.to }),
      };

    case "TeamFormed":
      return {
        ...state,
        teams: [
          ...state.teams,
          { id: event.teamId, name: event.name, formedAt: event.effectiveDate },
        ],
      };

    case "PersonTransferred":
      return {
        ...state,
        memberships: [
          ...state.memberships.filter(
            (m) =>
              !(m.personId === event.personId && m.teamId === event.fromTeamId),
          ),
          { personId: event.personId, teamId: event.toTeamId },
        ],
      };

    case "CustomerSigned":
      return {
        ...state,
        customers: [
          ...state.customers,
          {
            id: event.customerId,
            name: event.name,
            signedAt: event.effectiveDate,
          },
        ],
      };

    // The event carries the person's full assignment vector, so the fold is a
    // last-write-wins replacement rather than a diff application.
    case "AllocationChanged":
      return {
        ...state,
        assignments: [
          ...state.assignments.filter((a) => a.personId !== event.personId),
          ...event.assignments.map((a) => ({
            personId: event.personId,
            target: a.target,
            pct: a.pct,
            ...(a.roleInContext === undefined
              ? {}
              : { roleInContext: a.roleInContext }),
          })),
        ],
      };

    default: {
      // Compile-time proof that all 9 kinds are handled.
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

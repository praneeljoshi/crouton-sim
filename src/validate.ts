import { applyEvent, emptyState } from "./apply";
import type { Event, State } from "./types";

/**
 * An independent referee: folds the log from scratch and reports every
 * invariant violation. It shares applyEvent with the generator but none of the
 * generator's legality logic, so it can actually catch generator bugs.
 * Internal targets are a fixed catalog, so only customer targets are checked.
 */
export function validateLog(events: Event[]): string[] {
  const problems: string[] = [];
  let state: State = emptyState();

  if (events.length === 0) return ["log is empty"];
  if (events[0]!.kind !== "CompanyFounded") {
    problems.push(`first event is ${events[0]!.kind}, expected CompanyFounded`);
  }

  events.forEach((event, index) => {
    const at = `#${index} ${event.eventId} ${event.kind}`;
    const person = "personId" in event
      ? state.people.find((p) => p.id === event.personId)
      : undefined;

    /** Every kind but PersonHired requires an existing, still-employed person. */
    const requireActive = (personId: string) => {
      if (person === undefined) problems.push(`${at}: references unhired person ${personId}`);
      else if (person.departedAt !== undefined) {
        problems.push(`${at}: references departed person ${personId}`);
      }
    };
    const requireTeam = (teamId: string) => {
      if (!state.teams.some((t) => t.id === teamId)) {
        problems.push(`${at}: references nonexistent team ${teamId}`);
      }
    };

    switch (event.kind) {
      case "PersonHired":
        if (person !== undefined) problems.push(`${at}: duplicate personId ${event.personId}`);
        if (event.teamId !== undefined) requireTeam(event.teamId);
        break;
      case "PersonDeparted":
      case "RoleChanged":
        requireActive(event.personId);
        break;
      case "PersonTransferred":
        requireActive(event.personId);
        if (event.fromTeamId !== null) requireTeam(event.fromTeamId);
        requireTeam(event.toTeamId);
        break;
      case "AllocationChanged": {
        requireActive(event.personId);
        let sum = 0;
        for (const a of event.assignments) {
          sum += a.pct;
          if (a.pct < 0) problems.push(`${at}: negative pct ${a.pct} on ${a.target.id}`);
          if (a.target.kind === "customer" && !state.customers.some((c) => c.id === a.target.id)) {
            problems.push(`${at}: allocates to unsigned customer ${a.target.id}`);
          }
        }
        if (sum > 100) problems.push(`${at}: allocation sums to ${sum}, exceeds 100`);
        break;
      }
      default:
        break;
    }

    state = applyEvent(state, event);

    if (event.kind === "PersonDeparted") {
      const departed = state.people.find((p) => p.id === event.personId);
      if (departed?.departedAt !== undefined && departed.departedAt < departed.hiredAt) {
        problems.push(`${at}: departedAt ${departed.departedAt} precedes hiredAt ${departed.hiredAt}`);
      }
    }
  });

  return problems;
}

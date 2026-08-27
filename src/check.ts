import { applyEvent, emptyState } from "./apply";
import { canFill, entryRolesOf, rolesOf } from "./model";
import type { OrgModel } from "./model";
import type { Scenario } from "./scenario";
import type { Event, State } from "./types";

/**
 * The validation layer. One function, one shape, one list of problems.
 *
 * Each section runs only if its input is supplied, so the same entry point
 * serves the cheap startup check (`check({ model, scenario })`) and the full
 * regression sweep (`check({ model, scenario, runs })`).
 *
 * It never generates anything. The caller supplies the runs, so validation
 * depends on nothing it is meant to be independent of.
 */
export type CheckInput = {
  model?: OrgModel;
  scenario?: Scenario;
  /** Generated logs to check. Several, because some rules are about the set. */
  runs?: Event[][];
};

export function check(input: CheckInput): string[] {
  const problems: string[] = [];
  if (input.model !== undefined) problems.push(...checkModel(input.model));
  if (input.scenario !== undefined) problems.push(...checkScenario(input.scenario));
  if (input.runs !== undefined) {
    input.runs.forEach((events, i) => {
      problems.push(...checkLog(events, input.model, `run ${i}`));
    });
    problems.push(...checkCoverage(input.runs));
  }
  return problems;
}

// --- The taxonomy going in ---

function checkModel(model: OrgModel): string[] {
  const problems: string[] = [];
  const roles = rolesOf(model);

  if (entryRolesOf(model).length === 0) problems.push("model: no entry roles, nobody can be hired");

  for (const role of roles) {
    const spec = model.roles[role]!;
    if (spec.fills.length === 0) problems.push(`model: role ${role} fills no slots`);

    const next = spec.promotesTo;
    if (next === undefined) continue;
    if (model.roles[next] === undefined) {
      problems.push(`model: role ${role} promotes to unknown role ${next}`);
      continue;
    }
    // The subtle one: a promotion must never cost a capability, or the promoted
    // person silently stops being eligible for work they already hold.
    for (const slot of spec.fills) {
      if (!canFill(model, next, slot)) {
        problems.push(`model: promotion ${role} -> ${next} loses the ability to fill "${slot}"`);
      }
    }
  }

  for (const work of [...model.customers, ...model.internal]) {
    if (work.needs.length === 0) problems.push(`model: ${work.name} requires no slots`);
    for (const slot of work.needs) {
      if (!roles.some((r) => canFill(model, r, slot))) {
        problems.push(`model: ${work.name} needs "${slot}", which no role can fill`);
      }
    }
  }
  return problems;
}

// --- The behaviour going in ---

function checkScenario(scenario: Scenario): string[] {
  const problems: string[] = [];
  const at = `scenario ${scenario.name}`;
  if (scenario.timeline.length === 0) return [`${at}: empty timeline`];

  let previous = 0;
  scenario.timeline.forEach(({ until, params }, i) => {
    // Out of order would silently select the wrong segment, since lookup is a find.
    if (until <= previous) {
      problems.push(`${at}: segment ${i} ends at ${until}, not after ${previous}`);
    }
    previous = until;

    const rates: [string, number][] = [
      ["hiring", params.hiring], ["attrition", params.attrition], ["deals", params.deals],
      ["staffing", params.staffing], ["internalProjects", params.internalProjects],
      ["orphanRate", params.orphanRate],
    ];
    for (const [name, value] of rates) {
      if (value < 0) problems.push(`${at}: segment ${i} has negative ${name}`);
    }
    // These are probabilities, not frequencies, so above 1 is meaningless.
    for (const name of ["attrition", "orphanRate"] as const) {
      if (params[name] > 1) problems.push(`${at}: segment ${i} has ${name} above 1`);
    }
    // Nothing to hire, sell, or staff means the segment generates nothing.
    if (params.hiring === 0 && params.deals === 0 && params.staffing === 0) {
      problems.push(`${at}: segment ${i} can generate no hiring, deals, or staffing`);
    }
  });

  if (previous < 1) problems.push(`${at}: timeline ends at ${previous}, leaving the run uncovered`);
  return problems;
}

// --- The stream coming out ---

/**
 * Folds the log independently of the generator, sharing only applyEvent — so it
 * can catch generator bugs rather than restate generator logic. The model is
 * optional; supplying it enables the role-eligibility rule.
 */
function checkLog(events: Event[], model: OrgModel | undefined, label: string): string[] {
  const problems: string[] = [];
  if (events.length === 0) return [`${label}: log is empty`];
  if (events[0]!.kind !== "CompanyFounded") {
    problems.push(`${label}: first event is ${events[0]!.kind}, expected CompanyFounded`);
  }

  let state: State = emptyState();

  events.forEach((event, index) => {
    const at = `${label} #${index} ${event.eventId} ${event.kind}`;

    // Order must be encoded in the data: sorting by timestamp is a no-op.
    const previous = events[index - 1];
    if (previous !== undefined && event.timestamp <= previous.timestamp) {
      problems.push(`${at}: timestamp ${event.timestamp} does not follow ${previous.timestamp}`);
    }
    if (event.timestamp.slice(0, 10) >= event.effectiveDate) {
      problems.push(`${at}: recorded on ${event.timestamp.slice(0, 10)}, not before it takes effect`);
    }

    const personId = "personId" in event ? event.personId : undefined;
    const person = personId === undefined
      ? undefined
      : state.people.find((p) => p.id === personId);

    const requireActive = () => {
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
        requireActive();
        break;
      case "PersonTransferred":
        requireActive();
        if (event.fromTeamId !== null) requireTeam(event.fromTeamId);
        requireTeam(event.toTeamId);
        break;
      case "AllocationChanged": {
        requireActive();
        let sum = 0;
        for (const a of event.assignments) {
          sum += a.pct;
          if (a.pct < 0) problems.push(`${at}: negative pct ${a.pct} on ${a.target.id}`);
          if (a.target.kind === "customer" && !state.customers.some((c) => c.id === a.target.id)) {
            problems.push(`${at}: allocates to unsigned customer ${a.target.id}`);
          }
          // The role rule: nobody may hold a slot their role cannot fill.
          if (model !== undefined && a.roleInContext !== undefined) {
            const role = person?.role;
            if (role === undefined || !canFill(model, role, a.roleInContext)) {
              problems.push(`${at}: ${role ?? "unknown role"} cannot fill "${a.roleInContext}"`);
            }
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

// --- What only the set of runs can show ---

/**
 * Some failures are invisible to any static rule. A regime that omits
 * TeamFormed strands CustomerSigned, because that dependency lives in the
 * generator's legality rules — the only way to see it is that the event never
 * appears. This asks whether each mechanism ever engaged, not whether the org
 * ended healthy, since a pathological scenario is supposed to end unhealthy.
 */
function checkCoverage(runs: Event[][]): string[] {
  const occurred = new Set(runs.flat().map((e) => e.kind));
  return (["PersonHired", "TeamFormed", "CustomerSigned", "AllocationChanged"] as const)
    .filter((kind) => !occurred.has(kind))
    .map((kind) => `coverage: ${kind} never occurred in any run`);
}

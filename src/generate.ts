import { applyEvent, emptyState } from "./apply";
import {
  CITIES,
  COMPANY,
  DEFAULT_MODEL,
  NAMES,
  TEAM_NAMES,
  canFill,
  entryRolesOf,
  needsOf,
  promotionOf,
} from "./model";
import type { OrgModel, Slot } from "./model";
import { DEFAULT_SCENARIO, paramsAt } from "./scenario";
import type { Scenario, SimParams } from "./scenario";
import { mulberry32, weightedPick } from "./rng";
import type { Assignment, Base, Event, EventKind, Source, State, Target } from "./types";

/** Team formation threshold — SPEC's rule: teams form as headcount crosses it. */
const TEAM_SIZE = 5;

/** Background HR churn, per active person per month. */
const PROMOTION_RATE = 0.02;
const TRANSFER_RATE = 0.025;
const RELOCATION_CHANCE = 0.01;

/** Never let the org drop below this. */
const MIN_HEADCOUNT = 2;

const DEPARTURE_REASONS: ["voluntary" | "involuntary", number][] = [
  ["voluntary", 75],
  ["involuntary", 25],
];

/** Provenance is a property of the fact, so it is fixed per kind. */
const SOURCE_OF: Record<EventKind, Source> = {
  CompanyFounded: "manual",
  CompanyRelocated: "manual",
  PersonHired: "hris",
  PersonDeparted: "hris",
  RoleChanged: "hris",
  TeamFormed: "hris",
  PersonTransferred: "hris",
  CustomerSigned: "project_tool",
  AllocationChanged: "project_tool",
};

const START_YEAR = 2024;
const START_MONTH = 10; // Oct 2024

/** Percentages a single slot is staffed at. */
const PCT_GRID = [10, 20, 25, 30, 40, 50];

/** Below this, a person has no room worth assigning. */
const MIN_PCT = 5;

// --- Small helpers ---

function pick<T>(rng: () => number, items: T[]): T {
  if (items.length === 0) throw new Error("pick: no items");
  return items[Math.floor(rng() * items.length)]!;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Month index → calendar year/month, counting from the founding month. */
function monthOf(index: number): { year: number; month: number } {
  const zeroBased = START_MONTH - 1 + index;
  return { year: START_YEAR + Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

export function effectiveDateOf(index: number): string {
  const { year, month } = monthOf(index);
  return `${year}-${pad(month)}-01`;
}

/**
 * Recorded in the prior month, effective the 1st — ordinary HRIS effective-dating.
 * `seq` is the event's position within its month, so timestamps strictly increase
 * with emission order: sorting the log by timestamp reproduces the generated
 * order exactly. Eight events per day keeps `seq` inside the 20th–27th window.
 */
function timestampOf(index: number, seq: number): string {
  const { year, month } = monthOf(index - 1);
  const day = 20 + Math.floor(seq / 8);
  const hour = 9 + (seq % 8);
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:00:00.000Z`;
}

function activePeople(state: State) {
  return state.people.filter((p) => p.departedAt === undefined);
}

function teamOf(state: State, personId: string): string | null {
  return state.memberships.find((m) => m.personId === personId)?.teamId ?? null;
}

function targetKey(t: Target): string {
  return `${t.kind}:${t.id}`;
}

// --- Staffing slots: the bridge between roles and work ---

/** An unfilled staffing requirement on a piece of work. */
type OpenSlot = { target: Target; slot: Slot };

/**
 * Every requirement, across signed customers and running internal efforts, with
 * nobody on it. The internal side is sized by `internalProjects`, so internal
 * work is a demand source that competes with customers rather than a fixed pool
 * that fills once and never matters again.
 */
function openSlots({ model, params }: Sim, state: State): OpenSlot[] {
  const internalCount = Math.max(0, Math.round(params.internalProjects));
  const targets: Target[] = [
    ...state.customers.map((c): Target => ({ kind: "customer", id: c.id })),
    ...Array.from({ length: internalCount }, (_, i): Target => ({ kind: "internal", id: `i${i + 1}` })),
  ];
  const open: OpenSlot[] = [];
  for (const target of targets) {
    for (const slot of needsOf(model, target)) {
      const filled = state.assignments.some(
        (a) => targetKey(a.target) === targetKey(target) && a.roleInContext === slot,
      );
      if (!filled) open.push({ target, slot });
    }
  }
  return open;
}

const loadOf = (state: State, personId: string) =>
  state.assignments.filter((a) => a.personId === personId).reduce((s, a) => s + a.pct, 0);

const countOf = (state: State, personId: string) =>
  state.assignments.filter((a) => a.personId === personId).length;

/**
 * Who may take this slot: the role must be eligible for it, and the person must
 * have capacity left. Role eligibility is the rule; capacity keeps sum <= 100.
 */
function candidatesFor(model: OrgModel, state: State, open: OpenSlot) {
  return activePeople(state).filter(
    (p) => canFill(model, p.role, open.slot) && loadOf(state, p.id) <= 100 - MIN_PCT,
  );
}

/** Existing assignments, re-emitted verbatim so a new slot does not churn old ones. */
function keepExisting(state: State, personId: string) {
  return state.assignments
    .filter((a) => a.personId === personId)
    .map((a) => ({
      target: a.target,
      pct: a.pct,
      ...(a.roleInContext === undefined ? {} : { roleInContext: a.roleInContext }),
    }));
}

// --- Payload builders: one per event kind, each returns a valid event or null ---

type MakeBase = (kind: EventKind) => Base;

/** The world and the parameters currently governing it. Resolved fresh each month. */
type Sim = { model: OrgModel; params: SimParams };

type Builder = (sim: Sim, state: State, rng: () => number, base: MakeBase) => Event | null;

function buildCompanyFounded(base: MakeBase): Event {
  return {
    ...base("CompanyFounded"),
    kind: "CompanyFounded",
    name: COMPANY.name,
    location: COMPANY.location,
    founder: COMPANY.founder,
  };
}

const buildCompanyRelocated: Builder = (_sim, state, rng, base) => {
  if (state.company === null) return null;
  const from = state.company.location;
  return {
    ...base("CompanyRelocated"),
    kind: "CompanyRelocated",
    from,
    to: pick(rng, CITIES.filter((c) => c !== from)),
  };
};

/** Hiring is demand-biased: roles that clear open slots are likelier to be hired. */
const buildPersonHired: Builder = (sim, state, rng, base) => {
  const { model } = sim;
  // Names repeat with a suffix once the corpus is exhausted, so headcount is
  // bounded by the growth rate rather than by how many names were written down.
  const taken = new Set(state.people.map((p) => p.name));
  const available = NAMES.filter((n) => !taken.has(n));
  const round = Math.floor(state.people.length / NAMES.length) + 1;
  const name = available.length > 0 ? pick(rng, available) : `${pick(rng, NAMES)} ${round}`;

  const open = openSlots(sim, state);
  const weights = entryRolesOf(model).map(
    (role): [string, number] => [
      role,
      1 + 3 * open.filter((o) => canFill(model, role, o.slot)).length,
    ],
  );

  const teamId =
    state.teams.length > 0 && rng() < 0.75 ? pick(rng, state.teams).id : undefined;
  return {
    ...base("PersonHired"),
    kind: "PersonHired",
    personId: `p${state.people.length + 1}`,
    name,
    role: weightedPick(rng, weights),
    employmentType: weightedPick(rng, [
      ["full_time" as const, 80],
      ["contractor" as const, 15],
      ["part_time" as const, 5],
    ]),
    ...(teamId === undefined ? {} : { teamId }),
  };
};

// PersonDeparted has no builder: departures are a per-person hazard drawn in
// the monthly loop, not a random pick from the roster.

const buildRoleChanged: Builder = ({ model }, state, rng, base) => {
  const promotable = activePeople(state).filter(
    (p) => promotionOf(model, p.role) !== undefined,
  );
  if (promotable.length === 0) return null;
  const person = pick(rng, promotable);
  return {
    ...base("RoleChanged"),
    kind: "RoleChanged",
    personId: person.id,
    from: person.role,
    to: promotionOf(model, person.role)!,
  };
};

const buildTeamFormed: Builder = (_sim, state, _rng, base) => {
  // Names cycle, so the headcount threshold keeps working past the corpus.
  const index = state.teams.length;
  const base_ = TEAM_NAMES[index % TEAM_NAMES.length]!;
  const round = Math.floor(index / TEAM_NAMES.length) + 1;
  return {
    ...base("TeamFormed"),
    kind: "TeamFormed",
    teamId: `t${index + 1}`,
    name: round === 1 ? base_ : `${base_} ${round}`,
  };
};

const buildPersonTransferred: Builder = (_sim, state, rng, base) => {
  const active = activePeople(state);
  if (active.length === 0 || state.teams.length < 2) return null;
  const person = pick(rng, active);
  const fromTeamId = teamOf(state, person.id);
  const options = state.teams.filter((t) => t.id !== fromTeamId);
  if (options.length === 0) return null;
  return {
    ...base("PersonTransferred"),
    kind: "PersonTransferred",
    personId: person.id,
    fromTeamId,
    toTeamId: pick(rng, options).id,
  };
};

const buildCustomerSigned: Builder = ({ model }, state, _rng, base) => {
  if (model.customers.length === 0) return null;
  // Templates cycle once exhausted, so the deal rate is the only thing capping
  // customer count. The suffix keeps names unique.
  const index = state.customers.length;
  const template = model.customers[index % model.customers.length]!;
  const round = Math.floor(index / model.customers.length) + 1;
  return {
    ...base("CustomerSigned"),
    kind: "CustomerSigned",
    customerId: `c${index + 1}`,
    name: round === 1 ? template.name : `${template.name} ${round}`,
  };
};

/**
 * Allocation is slot-driven, not person-driven: pick an unfilled requirement,
 * then find someone whose role can actually do it, preferring the least loaded.
 */
const buildAllocationChanged: Builder = (sim, state, rng, base) => {
  const { model } = sim;
  const fillable = openSlots(sim, state).filter(
    (o) => candidatesFor(model, state, o).length > 0,
  );
  if (fillable.length === 0) return null;

  // No bias knob: internal and customer slots compete on equal footing, and how
  // much attention internal work gets follows from how much of it there is.
  const first = pick(rng, fillable);
  const candidates = candidatesFor(model, state, first);
  const fewest = Math.min(...candidates.map((p) => countOf(state, p.id)));
  const person = pick(rng, candidates.filter((p) => countOf(state, p.id) === fewest));

  // Staff this person onto as much open work as their role and capacity allow.
  // Filling several slots per event is what lets staffing keep pace with selling.
  const headroom = 100 - loadOf(state, person.id);
  return {
    ...base("AllocationChanged"),
    kind: "AllocationChanged",
    personId: person.id,
    assignments: [
      ...keepExisting(state, person.id),
      {
        target: first.target,
        pct: Math.min(pick(rng, PCT_GRID), headroom),
        roleInContext: first.slot,
      },
    ],
  };
};

// --- Poisson draws, so each driver emits its own events independently ---

/** Knuth's method. Deterministic given the seeded rng. */
function poisson(rng: () => number, mean: number): number {
  if (mean <= 0) return 0;
  const limit = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit);
  return k - 1;
}

export function generate(
  seed: number,
  months: number,
  model: OrgModel = DEFAULT_MODEL,
  scenario: Scenario = DEFAULT_SCENARIO,
): Event[] {
  const rng = mulberry32(seed);
  const events: Event[] = [];
  let state = emptyState();
  let counter = 0;
  let month = 0;
  let lastMonth = 0;
  let monthSeq = 0;

  const base: MakeBase = (kind) => {
    if (month !== lastMonth) {
      lastMonth = month;
      monthSeq = 0;
    }
    return {
      eventId: `e${++counter}`,
      timestamp: timestampOf(month, monthSeq++),
      effectiveDate: effectiveDateOf(month),
      source: SOURCE_OF[kind],
    };
  };

  const emit = (event: Event) => {
    events.push(event);
    state = applyEvent(state, event);
  };

  let sim: Sim = { model, params: DEFAULT_SCENARIO.timeline[0]!.params };

  /** Emit up to n events of one kind, stopping when the builder runs dry. */
  const emitMany = (build: Builder, n: number): void => {
    for (let i = 0; i < n; i++) {
      const event = build(sim, state, rng, base);
      if (event === null) return;
      emit(event);
    }
  };

  emit(buildCompanyFounded(base)); // the log always opens here

  for (month = 0; month < months; month++) {
    const params = paramsAt(scenario, month, months);
    if (params === undefined) continue;
    sim = { model, params };

    // 1. Departures. A per-person hazard, so this scales with headcount on its
    //    own rather than needing a rate that someone remembered to raise.
    for (const person of activePeople(state)) {
      if (activePeople(state).length <= MIN_HEADCOUNT) break;
      if (state.people.find((p) => p.id === person.id)?.departedAt !== undefined) continue;
      if (rng() >= params.attrition) continue;

      const stranded = state.assignments.filter(
        (a) => a.personId === person.id && a.target.kind === "customer",
      );
      emit({
        ...base("PersonDeparted"),
        kind: "PersonDeparted",
        personId: person.id,
        reason: weightedPick(rng, DEPARTURE_REASONS),
      });
      if (stranded.length > 0) cascade(stranded, params);
    }

    // 2. Hiring.
    emitMany(buildPersonHired, poisson(rng, params.hiring));

    // 3. Teams form when headcount crosses a threshold — a consequence of
    //    growth, not a separately tuned rate.
    const wanted = Math.floor(activePeople(state).length / TEAM_SIZE);
    while (state.teams.length < wanted) {
      const event = buildTeamFormed(sim, state, rng, base);
      if (event === null) break;
      emit(event);
    }

    // 4. Deals.
    emitMany(buildCustomerSigned, poisson(rng, params.deals));

    // 5. Staffing, capped by how much work is actually open and fillable.
    emitMany(buildAllocationChanged, poisson(rng, params.staffing));

    // 6. Background HR churn, proportional to headcount.
    const headcount = activePeople(state).length;
    emitMany(buildRoleChanged, poisson(rng, headcount * PROMOTION_RATE));
    emitMany(buildPersonTransferred, poisson(rng, headcount * TRANSFER_RATE));
    if (rng() < RELOCATION_CHANCE) emitMany(buildCompanyRelocated, 1);
  }

  /**
   * Departure cascade, per stranded assignment: hand the slot to someone whose
   * role can actually fill it, or deliberately leave it open. A slot with no
   * eligible survivor stays open on its own — that is hiring pressure, not a bug.
   */
  function cascade(stranded: Assignment[], params: SimParams): void {
    for (const a of stranded) {
      if (a.roleInContext === undefined) continue;
      if (rng() < params.orphanRate) continue; // orphan this slot on purpose

      const open: OpenSlot = { target: a.target, slot: a.roleInContext as Slot };
      const candidates = candidatesFor(model, state, open);
      if (candidates.length === 0) continue; // nobody eligible — the slot reopens

      const heir = pick(rng, candidates);
      emit({
        ...base("AllocationChanged"),
        kind: "AllocationChanged",
        personId: heir.id,
        assignments: [
          ...keepExisting(state, heir.id),
          {
            target: a.target,
            pct: Math.min(a.pct, 100 - loadOf(state, heir.id)),
            roleInContext: open.slot,
          },
        ],
      });
    }
  }

  return events;
}

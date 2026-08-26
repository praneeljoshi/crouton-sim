import { applyEvent, emptyState } from "./apply";
import { mulberry32, weightedPick } from "./rng";
import type {
  Assignment,
  Base,
  Event,
  EventKind,
  Source,
  State,
  Target,
} from "./types";

// --- Corpus: fixed vocabularies, so a seed fully determines the org. ---

const COMPANY = { name: "Crouton", location: "Charlotte, NC", founder: "Adam" };

const NAMES = [
  "Breno", "Maya", "Devon", "Priya", "Luis", "Ingrid", "Tomas", "Nadia",
  "Ravi", "Sofia", "Marcus", "Yuki", "Elena", "Omar", "Claire", "Jonas",
  "Amara", "Felix", "Rosa", "Dimitri", "Hana", "Caleb", "Lena", "Isaac",
  "Nora", "Pavel", "Zara", "Theo", "Mei", "Gabriel",
];

const TEAM_NAMES = [
  "Platform", "Design", "Forward Deployed", "Data", "Growth", "Infrastructure",
];

const CUSTOMER_NAMES = [
  "Northwind", "Acme Health", "Meridian Bank", "Voltaic", "Redwood Logistics",
  "Pinecrest Retail", "Halcyon Insurance", "Barrow Manufacturing",
];

/**
 * Internal efforts are a fixed catalog, not org entities: SPEC allows no event
 * kind that creates one, so they are always-legal allocation targets.
 */
const INTERNAL_EFFORTS = [
  { id: "i1", name: "Claims Engine" },
  { id: "i2", name: "Billing Platform" },
  { id: "i3", name: "Internal Tooling" },
];

const ROLES = [
  "Founding Engineer", "Platform Engineer", "Product Designer",
  "Forward Deployed Engineer", "Data Engineer", "Account Executive",
  "Support Engineer",
];

/** RoleChanged walks this ladder, so promotions read as promotions. */
const PROMOTIONS: Record<string, string> = {
  "Founding Engineer": "Head of Engineering",
  "Platform Engineer": "Senior Platform Engineer",
  "Senior Platform Engineer": "Staff Platform Engineer",
  "Product Designer": "Senior Product Designer",
  "Forward Deployed Engineer": "Lead Forward Deployed Engineer",
  "Data Engineer": "Senior Data Engineer",
  "Account Executive": "Enterprise Account Executive",
  "Support Engineer": "Support Lead",
};

const CITIES = ["Charlotte, NC", "Durham, NC", "Austin, TX", "New York, NY"];

const CONTEXT_ROLES = ["FDE support", "technical lead", "account lead", "onboarding"];

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

/** Recorded in the prior month, effective the 1st — ordinary HRIS effective-dating. */
function timestampOf(index: number, rng: () => number): string {
  const { year, month } = monthOf(index - 1);
  const day = 20 + Math.floor(rng() * 8);
  return `${year}-${pad(month)}-${pad(day)}T15:00:00.000Z`;
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

/**
 * Assign percentages that always satisfy the invariant: each drawn from a
 * coarse grid, then scaled down with floor() if the total would exceed 100.
 */
function allocate(rng: () => number, targets: Target[]): Assignment["pct"][] {
  const raw = targets.map(() => pick(rng, [10, 20, 25, 30, 40, 50]));
  const total = raw.reduce((s, n) => s + n, 0);
  if (total <= 100) return raw;
  return raw.map((n) => Math.floor((n / total) * 100));
}

/** All legal allocation targets: signed customers plus the internal catalog. */
function targetPool(state: State): Target[] {
  return [
    ...state.customers.map((c): Target => ({ kind: "customer", id: c.id })),
    ...INTERNAL_EFFORTS.map((e): Target => ({ kind: "internal", id: e.id })),
  ];
}

function distinctTargets(rng: () => number, state: State, count: number): Target[] {
  const pool = targetPool(state);
  const chosen: Target[] = [];
  while (chosen.length < count && chosen.length < pool.length) {
    const t = pick(rng, pool);
    if (!chosen.some((c) => targetKey(c) === targetKey(t))) chosen.push(t);
  }
  return chosen;
}

function contextRole(rng: () => number, target: Target): string | undefined {
  if (target.kind !== "customer") return undefined;
  return rng() < 0.5 ? pick(rng, CONTEXT_ROLES) : undefined;
}

/** Build a full assignment vector for a person over the given targets. */
function vectorFor(
  rng: () => number,
  targets: Target[],
  keepRole: Map<string, string>,
): { target: Target; pct: number; roleInContext?: string }[] {
  const pcts = allocate(rng, targets);
  return targets.map((target, i) => {
    const role = keepRole.get(targetKey(target)) ?? contextRole(rng, target);
    return {
      target,
      pct: pcts[i]!,
      ...(role === undefined ? {} : { roleInContext: role }),
    };
  });
}

// --- Payload builders: one per event kind, each returns a valid event or null ---

type MakeBase = (kind: EventKind) => Base;

function buildCompanyFounded(base: MakeBase): Event {
  return {
    ...base("CompanyFounded"),
    kind: "CompanyFounded",
    name: COMPANY.name,
    location: COMPANY.location,
    founder: COMPANY.founder,
  };
}

function buildCompanyRelocated(state: State, rng: () => number, base: MakeBase): Event | null {
  if (state.company === null) return null;
  const from = state.company.location;
  const options = CITIES.filter((c) => c !== from);
  return { ...base("CompanyRelocated"), kind: "CompanyRelocated", from, to: pick(rng, options) };
}

function buildPersonHired(state: State, rng: () => number, base: MakeBase): Event | null {
  const taken = new Set(state.people.map((p) => p.name));
  const available = NAMES.filter((n) => !taken.has(n));
  if (available.length === 0) return null;
  const teamId =
    state.teams.length > 0 && rng() < 0.75 ? pick(rng, state.teams).id : undefined;
  return {
    ...base("PersonHired"),
    kind: "PersonHired",
    personId: `p${state.people.length + 1}`,
    name: pick(rng, available),
    role: pick(rng, ROLES),
    employmentType: weightedPick(rng, [
      ["full_time" as const, 80],
      ["contractor" as const, 15],
      ["part_time" as const, 5],
    ]),
    ...(teamId === undefined ? {} : { teamId }),
  };
}

function buildPersonDeparted(state: State, rng: () => number, base: MakeBase): Event | null {
  const active = activePeople(state);
  if (active.length === 0) return null;
  return {
    ...base("PersonDeparted"),
    kind: "PersonDeparted",
    personId: pick(rng, active).id,
    reason: weightedPick(rng, [["voluntary" as const, 75], ["involuntary" as const, 25]]),
  };
}

function buildRoleChanged(state: State, rng: () => number, base: MakeBase): Event | null {
  const promotable = activePeople(state).filter((p) => PROMOTIONS[p.role] !== undefined);
  if (promotable.length === 0) return null;
  const person = pick(rng, promotable);
  return {
    ...base("RoleChanged"),
    kind: "RoleChanged",
    personId: person.id,
    from: person.role,
    to: PROMOTIONS[person.role]!,
  };
}

function buildTeamFormed(state: State, _rng: () => number, base: MakeBase): Event | null {
  const name = TEAM_NAMES[state.teams.length];
  if (name === undefined) return null;
  return { ...base("TeamFormed"), kind: "TeamFormed", teamId: `t${state.teams.length + 1}`, name };
}

function buildPersonTransferred(state: State, rng: () => number, base: MakeBase): Event | null {
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
}

function buildCustomerSigned(state: State, rng: () => number, base: MakeBase): Event | null {
  const name = CUSTOMER_NAMES[state.customers.length];
  if (name === undefined) return null;
  void rng;
  return {
    ...base("CustomerSigned"),
    kind: "CustomerSigned",
    customerId: `c${state.customers.length + 1}`,
    name,
  };
}

function buildAllocationChanged(state: State, rng: () => number, base: MakeBase): Event | null {
  const active = activePeople(state);
  if (active.length === 0) return null;
  const person = pick(rng, active);
  const count = weightedPick(rng, [[1, 40], [2, 40], [3, 20]]);
  const targets = distinctTargets(rng, state, count);
  if (targets.length === 0) return null;
  const keep = new Map(
    state.assignments
      .filter((a) => a.personId === person.id && a.roleInContext !== undefined)
      .map((a) => [targetKey(a.target), a.roleInContext!] as const),
  );
  return {
    ...base("AllocationChanged"),
    kind: "AllocationChanged",
    personId: person.id,
    assignments: vectorFor(rng, targets, keep),
  };
}

const BUILDERS: Record<
  Exclude<EventKind, "CompanyFounded">,
  (state: State, rng: () => number, base: MakeBase) => Event | null
> = {
  CompanyRelocated: buildCompanyRelocated,
  PersonHired: buildPersonHired,
  PersonDeparted: buildPersonDeparted,
  RoleChanged: buildRoleChanged,
  TeamFormed: buildTeamFormed,
  PersonTransferred: buildPersonTransferred,
  CustomerSigned: buildCustomerSigned,
  AllocationChanged: buildAllocationChanged,
};

// --- Menu: which events are legal now, and how likely each is ---

/** Phase by absolute month, so a 24-month run traverses all three. */
function phaseOf(month: number): "early" | "growth" | "steady" {
  if (month < 6) return "early";
  if (month < 18) return "growth";
  return "steady";
}

const WEIGHTS: Record<
  ReturnType<typeof phaseOf>,
  Partial<Record<Exclude<EventKind, "CompanyFounded">, number>>
> = {
  // Early: hires dominate, first teams form.
  early: { PersonHired: 60, TeamFormed: 20, AllocationChanged: 10, CustomerSigned: 8, RoleChanged: 2 },
  // Growth: customers sign, allocations churn, transfers and promotions appear.
  growth: {
    PersonHired: 25, AllocationChanged: 25, CustomerSigned: 20,
    PersonTransferred: 10, RoleChanged: 8, TeamFormed: 7, PersonDeparted: 5,
  },
  // Steady: departures rise, relocation becomes possible.
  steady: {
    AllocationChanged: 25, PersonDeparted: 22, PersonHired: 15, CustomerSigned: 12,
    RoleChanged: 10, PersonTransferred: 10, CompanyRelocated: 6,
  },
};

/** Legality gates — an event kind only reaches the draw if it can be built. */
function isLegal(kind: Exclude<EventKind, "CompanyFounded">, state: State): boolean {
  const active = activePeople(state).length;
  switch (kind) {
    case "PersonHired":
      return state.people.length < NAMES.length;
    case "TeamFormed":
      return active >= 4 && state.teams.length < TEAM_NAMES.length;
    case "CustomerSigned":
      return state.teams.length >= 1 && state.customers.length < CUSTOMER_NAMES.length;
    case "PersonDeparted":
      return active >= 3; // never let the org drop below two people
    case "RoleChanged":
      return activePeople(state).some((p) => PROMOTIONS[p.role] !== undefined);
    case "PersonTransferred":
      return active >= 1 && state.teams.length >= 2;
    case "AllocationChanged":
      return active >= 1;
    case "CompanyRelocated":
      return state.company !== null;
  }
}

export function menu(
  state: State,
  month: number,
): [Exclude<EventKind, "CompanyFounded">, number][] {
  return Object.entries(WEIGHTS[phaseOf(month)])
    .map(([kind, weight]) => [kind as Exclude<EventKind, "CompanyFounded">, weight!] as const)
    .filter(([kind]) => isLegal(kind, state))
    .map(([kind, weight]) => [kind, weight]);
}

// --- The generation loop ---

export function generate(seed: number, months: number): Event[] {
  const rng = mulberry32(seed);
  const events: Event[] = [];
  let state = emptyState();
  let counter = 0;
  let month = 0;

  const base: MakeBase = (kind) => ({
    eventId: `e${++counter}`,
    timestamp: timestampOf(month, rng),
    effectiveDate: effectiveDateOf(month),
    source: SOURCE_OF[kind],
  });

  const emit = (event: Event) => {
    events.push(event);
    state = applyEvent(state, event);
  };

  emit(buildCompanyFounded(base)); // the log always opens here

  for (month = 0; month < months; month++) {
    const count = weightedPick(rng, [[0, 1], [1, 3], [2, 3], [3, 2]]);
    for (let i = 0; i < count; i++) {
      const options = menu(state, month);
      if (options.length === 0) continue;
      const kind = weightedPick(rng, options);
      const event = BUILDERS[kind](state, rng, base);
      if (event === null) continue;

      // Read the departing person's customer work before the fold releases it.
      const stranded =
        event.kind === "PersonDeparted"
          ? state.assignments.filter(
              (a) => a.personId === event.personId && a.target.kind === "customer",
            )
          : [];

      emit(event);

      if (stranded.length > 0) cascade(stranded);
    }
  }

  /**
   * Departure cascade: hand the customer work to a survivor, or deliberately
   * orphan it ~30% of the time — the pathology the product exists to surface.
   */
  function cascade(stranded: Assignment[]): void {
    if (rng() < 0.3) return; // orphan on purpose
    const survivors = activePeople(state);
    if (survivors.length === 0) return;
    const heir = pick(rng, survivors);

    const existing = state.assignments.filter((a) => a.personId === heir.id);
    const targets: Target[] = [...existing.map((a) => a.target)];
    const keep = new Map<string, string>();
    for (const a of [...existing, ...stranded]) {
      if (a.roleInContext !== undefined) keep.set(targetKey(a.target), a.roleInContext);
    }
    for (const a of stranded) {
      if (!targets.some((t) => targetKey(t) === targetKey(a.target))) targets.push(a.target);
    }

    emit({
      ...base("AllocationChanged"),
      kind: "AllocationChanged",
      personId: heir.id,
      assignments: vectorFor(rng, targets, keep),
    });
  }

  return events;
}

export { INTERNAL_EFFORTS };

import type { Target } from "./types";

/**
 * The org model: the taxonomy the simulator generates against, as a first-class
 * value. `roles` is the single source of truth — the role list, the hireable
 * subset, the promotion ladder, and slot eligibility are all derived from it,
 * so they cannot drift apart the way parallel tables would.
 */

/** A contextual role on a piece of work — the slot an assignment fills. */
export type Slot =
  | "account lead"
  | "FDE support"
  | "technical lead"
  | "data integration"
  | "onboarding"
  | "design partner";

export type RoleSpec = {
  /** Which slots someone in this role may fill. */
  fills: Slot[];
  /** The next rung on the ladder, if any. */
  promotesTo?: string;
  /** Whether people are hired directly into this role, or only promoted into it. */
  entry?: boolean;
};

/** A piece of work and the slots it requires staffed. */
export type WorkSpec = { id: string; name: string; needs: Slot[] };

export type OrgModel = {
  roles: Record<string, RoleSpec>;
  customers: WorkSpec[];
  internal: WorkSpec[];
};

// --- Accessors: every read of the model goes through one of these ---

export const rolesOf = (m: OrgModel): string[] => Object.keys(m.roles);

/** Roles people are hired into; the rest are reached only by promotion. */
export const entryRolesOf = (m: OrgModel): string[] =>
  rolesOf(m).filter((r) => m.roles[r]!.entry === true);

export const promotionOf = (m: OrgModel, role: string): string | undefined =>
  m.roles[role]?.promotesTo;

/** The eligibility rule: may someone in this role fill this slot? */
export function canFill(m: OrgModel, role: string, slot: string): boolean {
  const spec = m.roles[role];
  return spec !== undefined && (spec.fills as readonly string[]).includes(slot);
}

/**
 * The catalog entry for a target. Ids beyond the catalog cycle through its
 * templates, so the number of customers is bounded by the deal rate rather than
 * by how many templates were written down. Names come from the log, not here.
 */
export const workOf = (m: OrgModel, target: Target): WorkSpec | undefined => {
  const list = target.kind === "customer" ? m.customers : m.internal;
  const direct = list.find((w) => w.id === target.id);
  if (direct !== undefined) return direct;
  const n = Number(target.id.slice(1));
  return Number.isFinite(n) && list.length > 0 ? list[(n - 1) % list.length] : undefined;
};

/**
 * The display name for a target. Ids past the catalog reuse a template's
 * requirements but must not reuse its name, or several distinct efforts would
 * appear identical. Customer names come from the log instead, since the
 * CustomerSigned event carries them.
 */
export function workNameOf(m: OrgModel, target: Target): string {
  const list = target.kind === "customer" ? m.customers : m.internal;
  const spec = workOf(m, target);
  if (spec === undefined) return target.id;
  const n = Number(target.id.slice(1));
  if (!Number.isFinite(n) || list.length === 0) return spec.name;
  const round = Math.floor((n - 1) / list.length) + 1;
  return round === 1 ? spec.name : `${spec.name} ${round}`;
}

/** What a piece of work requires. Unknown targets require nothing. */
export const needsOf = (m: OrgModel, target: Target): Slot[] =>
  workOf(m, target)?.needs ?? [];

// --- The default taxonomy ---

const ROLE_CATALOG: Record<string, RoleSpec> = {
  "Founding Engineer": {
    fills: ["technical lead", "data integration"],
    promotesTo: "Head of Engineering",
    entry: true,
  },
  "Head of Engineering": { fills: ["technical lead", "data integration"] },

  "Platform Engineer": {
    fills: ["technical lead"],
    promotesTo: "Senior Platform Engineer",
    entry: true,
  },
  "Senior Platform Engineer": {
    fills: ["technical lead"],
    promotesTo: "Staff Platform Engineer",
  },
  "Staff Platform Engineer": { fills: ["technical lead"] },

  "Forward Deployed Engineer": {
    fills: ["FDE support", "onboarding"],
    promotesTo: "Lead Forward Deployed Engineer",
    entry: true,
  },
  "Lead Forward Deployed Engineer": {
    fills: ["FDE support", "onboarding", "technical lead"],
  },

  "Data Engineer": {
    fills: ["data integration"],
    promotesTo: "Senior Data Engineer",
    entry: true,
  },
  "Senior Data Engineer": { fills: ["data integration", "technical lead"] },

  "Product Designer": {
    fills: ["design partner"],
    promotesTo: "Senior Product Designer",
    entry: true,
  },
  "Senior Product Designer": { fills: ["design partner"] },

  "Account Executive": {
    fills: ["account lead"],
    promotesTo: "Enterprise Account Executive",
    entry: true,
  },
  "Enterprise Account Executive": { fills: ["account lead"] },

  "Support Engineer": {
    fills: ["onboarding"],
    promotesTo: "Support Lead",
    entry: true,
  },
  "Support Lead": { fills: ["onboarding", "account lead"] },
};

/** Signed in catalog order; larger accounts require more slots. */
const CUSTOMER_CATALOG: WorkSpec[] = [
  { id: "c1", name: "Northwind", needs: ["account lead", "FDE support", "data integration"] },
  { id: "c2", name: "Acme Health", needs: ["account lead", "onboarding"] },
  { id: "c3", name: "Meridian Bank", needs: ["account lead", "FDE support", "technical lead", "data integration"] },
  { id: "c4", name: "Voltaic", needs: ["FDE support"] },
  { id: "c5", name: "Redwood Logistics", needs: ["account lead", "data integration"] },
  { id: "c6", name: "Pinecrest Retail", needs: ["account lead", "onboarding"] },
  { id: "c7", name: "Halcyon Insurance", needs: ["account lead", "FDE support", "data integration"] },
  { id: "c8", name: "Barrow Manufacturing", needs: ["account lead", "onboarding", "design partner"] },
  { id: "c9", name: "Kestrel Energy", needs: ["account lead", "data integration"] },
  { id: "c10", name: "Alderman Legal", needs: ["account lead", "onboarding"] },
  { id: "c11", name: "Sableport Shipping", needs: ["account lead", "FDE support", "data integration"] },
  { id: "c12", name: "Vireo Biotech", needs: ["account lead", "technical lead", "data integration"] },
  { id: "c13", name: "Quarry Systems", needs: ["FDE support", "technical lead"] },
  { id: "c14", name: "Lumen Media", needs: ["account lead", "design partner"] },
  { id: "c15", name: "Fairbank Credit", needs: ["account lead", "FDE support", "data integration", "onboarding"] },
  { id: "c16", name: "Ostrander Foods", needs: ["account lead", "onboarding"] },
  { id: "c17", name: "Copperline Telecom", needs: ["account lead", "technical lead", "data integration"] },
  { id: "c18", name: "Wrenfield Hospitality", needs: ["account lead", "onboarding", "design partner"] },
  { id: "c19", name: "Thackery Pharma", needs: ["account lead", "data integration"] },
  { id: "c20", name: "Braddock Steel", needs: ["FDE support", "onboarding"] },
  { id: "c21", name: "Solvent Labs", needs: ["technical lead", "data integration"] },
  { id: "c22", name: "Marchetti Group", needs: ["account lead", "FDE support"] },
];

/**
 * Internal efforts exist from day one — no event creates them. `internalProjects`
 * decides how many of these are running, taking them in order, so the earliest
 * entries are the ones a small org would actually have. Sizes vary from one slot
 * to three so internal demand is lumpy rather than uniform.
 */
const INTERNAL_CATALOG: WorkSpec[] = [
  { id: "i1", name: "Claims Engine", needs: ["technical lead", "data integration"] },
  { id: "i2", name: "Billing Platform", needs: ["technical lead"] },
  { id: "i3", name: "Internal Tooling", needs: ["technical lead", "onboarding"] },
  { id: "i4", name: "Design System", needs: ["design partner"] },
  { id: "i5", name: "Ingestion Pipeline", needs: ["data integration", "technical lead", "onboarding"] },
  { id: "i6", name: "Identity and Access", needs: ["technical lead"] },
  { id: "i7", name: "Reporting Warehouse", needs: ["data integration"] },
  { id: "i8", name: "Onboarding Automation", needs: ["onboarding", "technical lead"] },
  { id: "i9", name: "Schema Registry", needs: ["data integration", "technical lead"] },
  { id: "i10", name: "Customer Portal", needs: ["design partner", "technical lead", "onboarding"] },
];

export const DEFAULT_MODEL: OrgModel = {
  roles: ROLE_CATALOG,
  customers: CUSTOMER_CATALOG,
  internal: INTERNAL_CATALOG,
};

// --- Cosmetic corpus: outside the model, because it changes no dynamics ---

export const COMPANY = { name: "Crouton", location: "Charlotte, NC", founder: "Adam" };

export const NAMES = [
  "Breno", "Maya", "Devon", "Priya", "Luis", "Ingrid", "Tomas", "Nadia",
  "Ravi", "Sofia", "Marcus", "Yuki", "Elena", "Omar", "Claire", "Jonas",
  "Amara", "Felix", "Rosa", "Dimitri", "Hana", "Caleb", "Lena", "Isaac",
  "Nora", "Pavel", "Zara", "Theo", "Mei", "Gabriel", "Anouk", "Bertrand",
  "Cosima", "Dashiell", "Esme", "Florian", "Greta", "Hugo", "Imani", "Jules",
  "Kiran", "Lior", "Milena", "Niall", "Odile", "Piers", "Quinn", "Rafael",
  "Saoirse", "Tobias", "Ulla", "Viggo", "Wren", "Xiomara", "Yusuf", "Zola",
  "Anders", "Beatriz", "Cyrus", "Dagny", "Emeka", "Fenna", "Goran", "Halle",
];

export const TEAM_NAMES = [
  "Platform", "Design", "Forward Deployed", "Data", "Growth", "Infrastructure",
];

export const CITIES = ["Charlotte, NC", "Durham, NC", "Austin, TX", "New York, NY"];

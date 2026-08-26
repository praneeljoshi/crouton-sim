// The canonical domain vocabulary. Real source payloads (Workday webhooks, Jira
// changes) are projections of these events; an adapter layer would map onto them.

export type Source = "hris" | "project_tool" | "manual";

export type EmploymentType = "full_time" | "part_time" | "contractor";

/** Where work is directed: an external customer or an internal effort. */
export type Target =
  | { kind: "customer"; id: string }
  | { kind: "internal"; id: string };

/** timestamp = when we learned it; effectiveDate = when it is true of the org. */
export type Base = {
  eventId: string;
  timestamp: string;
  effectiveDate: string;
  source: Source;
};

export type Event = Base &
  (
    | { kind: "CompanyFounded"; name: string; location: string; founder: string }
    | { kind: "CompanyRelocated"; from: string; to: string }
    | {
        kind: "PersonHired";
        personId: string;
        name: string;
        role: string;
        employmentType: EmploymentType;
        teamId?: string;
      }
    | { kind: "PersonDeparted"; personId: string; reason: "voluntary" | "involuntary" }
    | { kind: "RoleChanged"; personId: string; from: string; to: string }
    | { kind: "TeamFormed"; teamId: string; name: string }
    | {
        kind: "PersonTransferred";
        personId: string;
        fromTeamId: string | null;
        toTeamId: string;
      }
    | { kind: "CustomerSigned"; customerId: string; name: string }
    | {
        kind: "AllocationChanged";
        personId: string;
        assignments: { target: Target; pct: number; roleInContext?: string }[];
      }
  );

export type EventKind = Event["kind"];

// --- State: derived by folding the log; never the source of truth. ---

export type Company = { name: string; location: string; foundedAt: string };

/** Departed people are retained with a departedAt, so history stays replayable. */
export type Person = {
  id: string;
  name: string;
  role: string;
  employmentType: EmploymentType;
  hiredAt: string;
  departedAt?: string;
};

export type Team = { id: string; name: string; formedAt: string };

/** person↔team is M:N, so membership is its own row rather than a field. */
export type Membership = { personId: string; teamId: string };

export type Customer = { id: string; name: string; signedAt: string };

/** The junction table. Customer ownership is derived by querying these. */
export type Assignment = {
  personId: string;
  target: Target;
  pct: number;
  roleInContext?: string;
};

export type State = {
  company: Company | null;
  people: Person[];
  teams: Team[];
  memberships: Membership[];
  customers: Customer[];
  assignments: Assignment[];
};

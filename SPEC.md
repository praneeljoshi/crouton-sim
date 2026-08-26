Org Simulator — Design Spec

Take-home for Crouton. Build a program that simulates an organization's life as a timeline of events — formation, hires, teams, customers, allocation changes, departures — and outputs that timeline in human-readable and machine-readable form.

Time budget: 2–5 hours. Bias every decision toward small, correct, explainable.

Purpose & framing

Crouton syncs with company work systems (HRIS, project tools) to build a living, temporal map of who owns what work. This simulator is a test-fixture generator for that product: it emits a canonical event stream shaped like what Crouton's ingestion layer would normalize real-world payloads into.

Key framing (goes in README): real source payloads (Workday webhooks, Jira changes) are projections of canonical domain events. An adapter layer would map system-specific shapes onto this canonical taxonomy. The simulator generates the canonical stream directly — the layer all sources converge to.

Architecture

Event-sourced. The org is an append-only event log. State is derived by folding events. One applyEvent(state, event) function serves three jobs:

The generator's internal bookkeeping (generation reads current state)
The substrate for invariant checking
snapshotAt(t) for free — replay the log up to time t

Generation loop: seeded PRNG → repeat: read state → pick a plausible next event (weighted by org phase) → validate invariants → emit + apply. Same seed ⇒ same stream (deterministic; usable as a CI fixture).

Stack

TypeScript, run with tsx. No database, no server, no build pipeline. In-memory state only; the event log is the output. (Crouton's stack is TS/Postgres/React — match the language, skip the infra.)

State model (in-memory, folded from events)
ts
Company    { name, location, foundedAt }
Person     { id, name, role, employmentType, hiredAt, departedAt? }
Team       { id, name, formedAt }
Membership { personId, teamId }                          // person↔team, M:N
Customer   { id, name, signedAt }
Assignment { personId, target, pct, roleInContext? }     // the junction table
  // target: { kind: "customer", id } | { kind: "internal", id }

Design notes:

Role vs. allocation are orthogonal. Person.role is the primary/HRIS role ("Platform Engineer"). Assignments may carry a contextual role ("FDE support at Northwind"). One primary + N contextual.
Customer ownership is derived, never stored: the assignments targeting a customer. An "orphaned customer" = signed customer with zero active assignments — a state the simulator should be able to produce on purpose, because detecting it is Crouton's pitch.
Internal work (e.g. "Claims Engine" platform work) and customer work use the same Assignment mechanism via the polymorphic target.
Event model (9 types, discriminated union)
ts
type Base = { eventId: string; timestamp: string; effectiveDate: string;
              source: "hris" | "project_tool" | "manual" };

type Event = Base & (
  | { kind: "CompanyFounded";    name: string; location: string; founder: string }
  | { kind: "CompanyRelocated";  from: string; to: string }
  | { kind: "PersonHired";       personId: string; name: string; role: string;
      employmentType: "full_time" | "part_time" | "contractor"; teamId?: string }
  | { kind: "PersonDeparted";    personId: string; reason: "voluntary" | "involuntary" }
  | { kind: "RoleChanged";       personId: string; from: string; to: string }
  | { kind: "TeamFormed";        teamId: string; name: string }
  | { kind: "PersonTransferred"; personId: string; fromTeamId: string | null; toTeamId: string }
  | { kind: "CustomerSigned";    customerId: string; name: string }
  | { kind: "AllocationChanged"; personId: string;
      assignments: { target: { kind: "customer" | "internal"; id: string };
                     pct: number; roleInContext?: string }[] }
);

Design notes:

AllocationChanged carries the person's full assignment vector, not a diff. Each event is independently valid against the constraint (sum ≤ 100, components ≥ 0); the fold is last-write-wins per person; no event depends on reconstructing prior state to validate.
from/to pairs (Relocated, RoleChanged, Transferred) make the prose timeline self-describing without state lookups.
effectiveDate is separate from timestamp (HRIS effective-dating; the front door to bitemporality — record now, effective the 1st).
source tags provenance per event (which system a fact would have come from).
Invariants (enforced at generation time)
Allocation components ≥ 0 and sum ≤ 100 per person per time slice.
No events reference people not yet hired or already departed.
No allocations target customers not yet signed / teams not yet formed.
Departure cascade: when a person with assignments departs, either reassign (emit AllocationChanged for survivors) or deliberately orphan the customer sometimes — the pathology the product exists to surface.
First event is always CompanyFounded.
Generation heuristics (keep simple, weight by phase)
Early phase: hires dominate; teams form when headcount crosses thresholds.
Growth phase: customers sign; allocations churn; transfers/promotions appear.
Steady phase: departures rise; occasional relocation.
Parameterize: seed, months, growthRate, churnRate. CLI flags or a config object — whatever is fastest.
Outputs
Prose timeline (stdout) matching the style of the prompt's example: "Oct 2024 — Crouton founded in Charlotte, NC by Adam." etc.
JSON event log (file or stdout flag) — the ingestion-fixture artifact.
snapshotAt(t): print org state at a given date (people, teams, customers, allocation table). Demonstrates the fold.
Explicitly out of scope (name in README, do not build)
Persistence (Postgres), API server, React UI
Bitemporal storage (valid-time vs. knowledge-time) — effectiveDate is the hook
"Messiness injection": late-arriving events, corrections, duplicate payloads
System-specific emitters (Workday-shaped, Jira-shaped renderings of the canonical stream)
Funding events, compensation, TeamDissolved/CompanyDissolved
Deliverable checklist
 Repo with README: scoping decisions up top, "what I'd build next" at bottom
 npx tsx src/main.ts --seed 42 --months 24 runs end to end
 Prose timeline + JSON export + snapshotAt demo
 5–8 min video: (1) how I scoped the ambiguity, (2) event-sourced core and why, (3) live demo incl. a departure cascade / orphaned customer, (4) invariants + roadmap
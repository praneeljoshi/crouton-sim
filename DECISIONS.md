# Design Decisions

Context for whoever extends this next. Every decision in the code with the
reason behind it, so the next change does not silently undo one. It is longer
than a reviewer needs — bold text alone is the summary; the prose is for
someone about to touch the generator.

## Before you change anything

- **Any change to the org model, the rates, or the *order* of `rng()` calls
  re-rolls every seed.** Same seed, different stream. Doc excerpts, committed
  fixtures, and any measurement taken beforehand all go stale at once. Regenerate
  and re-verify rather than trusting a number from before the change.
- **Every lever backed by a fixed list silently caps out.** Person names,
  customer templates, team names, and internal projects all cycle with a suffix
  for exactly this reason. A new lever pointed at a fixed-size list will look
  like it works and then quietly stop responding — test its range.
- **`check.ts` must never import `generate`.** Its whole value is being an
  independent derivation of validity; the moment it reuses generator logic it
  agrees by construction and proves nothing.
- **Do not add an `rng()` call inside `base()`.** Timestamps are derived from a
  per-month counter so the log stays sortable; a random draw there reintroduces
  the inversions that made sorting a fixture corrupt it.
- **Adding a tenth event kind will fail the typecheck** in `applyEvent`. That is
  the intended behaviour, not an obstacle — handle it in the fold.

## Core architecture

- **Event sourcing; the log is truth, state is a fold.** Ownership is a temporal
  question, and a mutable state table can only answer "now."
- **One `applyEvent` serves three jobs** — generator bookkeeping, invariant
  checking, `snapshotAt` — so an event means exactly one thing.
- **`applyEvent` is pure and total**, never throwing, so it can replay logs of
  unknown provenance; legality belongs to the generator and referees.
- **Exhaustiveness is compiler-proved** via a `never` default branch, so a tenth
  event kind fails the typecheck instead of silently falling through.
- **`State` is a uniform bag of arrays**, because an index here would be
  optimization without a measurement.

## Event model

- **`AllocationChanged` carries the full vector, not a diff**, so each event is
  independently checkable against `sum <= 100` without reconstructing history.
- **The fold is last-write-wins per person**, which follows from the above.
- **`from`/`to` pairs on relocation, role change, and transfer** make the prose
  timeline self-describing without state lookups.
- **`effectiveDate` is separate from `timestamp`** — when a fact became true
  versus when we learned it; events are recorded the month before taking effect.
- **Timestamps derive from a per-month sequence counter, not the rng**, so they
  strictly increase with emission order and sorting the log by timestamp
  reproduces the generated order — a consumer that sorts cannot corrupt the log.
- **`source` is fixed per event kind, not random**, because provenance is a
  property of the fact.
- **`PersonDeparted` is a tombstone, not a delete.** It sets `departedAt` and
  releases assignments, keeping history replayable and stranded work visible.
- **Departure keeps team memberships**, since having been on a team is a fact;
  roster queries filter on `departedAt` instead.
- **`CompanyFounded.founder` creates no `Person`.** The event carries no
  `personId`, and inventing one would put unsourced data in the log.

## Domain modelling

- **Ownership is derived, never stored**, so it cannot drift from the log the way
  an `owner` column would.
- **Work declares staffing slots, and `roleInContext` names the slot it fills.**
  This uses the field SPEC already provides rather than adding one, and turns a
  decorative label into the load-bearing link between people and work.
- **A person may only fill a slot their role is eligible for.** Without this rule
  a Data Engineer could be an account lead, and the org map would be fiction.
- **Orphaning has three states, not two** — fully staffed, partially staffed,
  orphaned — and partial is the interesting one, because an account with a
  commercial owner and no engineer looks covered by headcount and isn't.
- **An orphaned customer is just a customer with no assignments** — no flag to
  maintain, which is why the detection is trustworthy.
- **`pct` is a share of the person's time, not the customer's.** The invariant is
  per person; a customer has no ceiling because that number would be meaningless.
- **`Person.role` and `Assignment.roleInContext` stay distinct** — one HRIS
  title, N slots held — related by eligibility rather than equality.
- **Internal work reuses `Assignment` via a polymorphic `target`**, so platform
  and customer work are one mechanism rather than two.
- **Internal efforts are catalog entries, not entities**, since no event kind
  creates one; this is why `check` validates customer targets but not internal.

## Configuration

- **`OrgModel` and `Scenario` are separate objects.** The taxonomy defines the
  world and rarely changes; behaviour is tuned every run. The same model runs
  under many scenarios and the same scenario runs against many models.
- **`ROLE_CATALOG` is the single source of truth for roles.** The role list, the
  hireable subset, the promotion ladder, and slot eligibility are all derived from
  it, so three parallel tables cannot fall out of sync.
- **Roles split into entry and promoted.** You are hired as a Platform Engineer
  and promoted into Staff; `entry: true` marks what hiring may draw from.
- **The model is a parameter, not a module singleton**, threaded through every
  builder — otherwise "configurable" would be a claim rather than a capability.
- **Cosmetic corpus lives outside the model.** Person names and cities change no
  dynamics, so bundling them into the taxonomy would only widen its surface.
- **Phases are not a concept; regimes are.** A regime is a parameter set like any
  other, and the classic formation/growth/steady arc is three of them in sequence
  — which is what lets `delivery-starved` compose the same way.
- **A run is a sequence of parameter sets**, so regime change is the top-level
  structure rather than something bolted onto a fixed three-phase model.
- **Rates are absolute frequencies, not shares of an activity budget.** With
  relative weights, multiplying every rate by ten changed nothing and no number
  meant anything on its own; `hiring: 2` now means two hires a month.
- **Total event volume is emergent**, because a busy org should be busy from
  having more happening, not from a dial that says so.
- **Only the drivers are configured.** Growth, churn, deals, and internal work
  are set; team formation, promotions, and transfers are consequences of them and
  are derived in the generator.
- **`attrition` is a per-person hazard**, so departures scale with headcount on
  their own rather than needing a rate someone remembered to raise.
- **Regime boundaries are fractions of the run, not absolute months**, so a
  6-month run and a 60-month run both traverse the whole arc.
- **Every lever backed by a fixed list silently caps out**, so names, customers,
  teams, and internal projects all cycle with a suffix once exhausted — the rate
  bounds the org, not how many names were written down.
- **Presets ship in both directions.** `understaffed` matters as much as
  `balanced`, because the pathological fixture is the product's reason to exist;
  further regimes are kept commented out rather than exposed.

## Generation

- **Seeded determinism via mulberry32.** A fixture that differs between runs is
  not a fixture.
- **No AI, no network, no wall clock**, so output is committable to CI.
- **Each driver emits its own events**, drawn from a Poisson with that driver's
  rate, which removed the weighted menu and the separate legality gate that had
  to agree with it.
- **Legality is enforced at the write side.** Builders draw only from active
  people, signed customers, and open slots, so invalid events are never
  constructed rather than constructed and filtered.
- **Teams form when headcount crosses a threshold** — SPEC's own rule, and a
  consequence of growth rather than a separately tuned rate.
- **Allocation is slot-driven, not person-driven.** Picking an unfilled
  requirement and then finding someone eligible is what makes staffing respond to
  demand instead of scattering randomly.
- **The least-loaded eligible person wins the slot**, which is what lifted
  coverage off the floor — random choice left most of the org unallocated.
- **One staffing decision fills one slot**, with volume set by the `staffing`
  rate — a clearer contract than an event that fills a variable number.
- **New assignments preserve existing percentages** rather than re-rolling the
  vector, so inheriting one account does not churn unrelated work.
- **Percentages come from a coarse grid, capped by remaining headroom**, making
  `sum <= 100` structurally impossible to violate rather than checked afterward.
- **Hiring is demand-biased**: roles that clear open slots are likelier to be
  hired, so headcount growth follows unmet need.
- **Departures require three active people**, one stricter than a floor of two,
  so the org never *drops* below two.
- **Promotions walk the catalog ladder** rather than rerolling the role, so a
  Designer never becomes a Platform Engineer.
- **The cascade decides per stranded slot**, handing each to an eligible survivor
  or leaving it open at `orphanRate`.
- **A slot with no eligible survivor simply reopens** — that is hiring pressure
  expressed through the model, not a failure case needing special handling.

## Output

- **Prose resolves ids to names by folding alongside the render**, using state as
  it stood *before* each event, when the referenced entity is guaranteed present.
- **"Allocation set to", not "allocated to."** The vector replaces rather than
  accumulates, and the wrong verb hides a silently dropped customer.
- **The snapshot names the missing slots**, not just the filled ones, because
  `[1/3] UNSTAFFED: account lead, FDE support` is the finding and a list of
  present owners is not.
- **Internal efforts get a suffixed display name past the catalog**, since
  customers take theirs from the log and internal work has no event to carry one.

## Validation

- **One function, not a family of referees.** `check({ model?, scenario?, runs? })`
  runs only the sections whose input is supplied, so the cheap startup check and
  the full sweep are the same entry point with different arguments.
- **The checker never generates.** An earlier version reached into `generate` to
  smoke-test scenarios, which made validation depend on the thing it was meant to
  judge independently; the caller supplies runs instead.
- **It folds with `applyEvent` and nothing else**, sharing no legality logic with
  the generator, so it can catch generator bugs rather than restate them.
- **It returns a list rather than throwing**, so a bad input is fully diagnosed
  in one pass.
- **Coverage rules are about the set of runs, not one run.** Some failures are
  only visible as an event kind that never appears, and that dependency lives in
  the generator, so no static rule can see it.
- **Coverage asks whether mechanisms fired, not whether the org ended healthy**,
  since a pathological scenario is supposed to end unhealthy.
- **Timestamp monotonicity and role eligibility are permanent rules**, having
  previously existed only in throwaway probes retyped after every change.
- **The CLI refuses to run a broken model or scenario**, because its output would
  be pathologies indistinguishable from real ones.

## Tooling

- **TypeScript via tsx; no build step, no runtime dependencies.** The log is the
  output, so there is nothing to compile or serve.
- **`@types/node` is the one added devDependency**, needed because the CLI reads
  `process.argv` and writes a file while the typecheck must stay clean.
- **`noUncheckedIndexedAccess` is on**, costing some ceremony around array access
  and catching the bug class this code is most exposed to.

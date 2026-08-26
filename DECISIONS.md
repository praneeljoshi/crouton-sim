# Design Decisions

Every decision in the code, one sentence each. Bold text alone is the summary.

## Core architecture

- **Event sourcing; the log is truth, state is a fold.** Ownership is a temporal
  question, and a mutable state table can only answer "now."
- **One `applyEvent` serves three jobs** — generator bookkeeping, invariant
  checking, `snapshotAt` — so an event means exactly one thing.
- **`applyEvent` is pure and total**, never throwing, so it can replay logs of
  unknown provenance; legality belongs to the generator and referee.
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
- **An orphaned customer is just a customer that query returns nothing for** — no
  flag to maintain, which is why the detection is trustworthy.
- **`pct` is a share of the person's time, not the customer's.** The invariant is
  per person; a customer has no ceiling because that number would be meaningless.
- **`Person.role` and `Assignment.roleInContext` are orthogonal** — one HRIS
  title, N contextual roles — because they are different facts.
- **Internal work reuses `Assignment` via a polymorphic `target`**, so platform
  and customer work are one mechanism rather than two.
- **Internal efforts are a hardcoded catalog, not entities**, since no event kind
  creates one; this is why the referee checks customer targets but not internal.

## Generation

- **Seeded determinism via mulberry32.** A fixture that differs between runs is
  not a fixture.
- **No AI, no network, no wall clock**, so output is committable to CI.
- **Legality is enforced at the write side.** `menu(state, month)` offers only
  legal kinds, so invalid events are never constructed, not constructed then filtered.
- **Phase weights key off absolute month** (hiring 0–5, customers and churn 6–17,
  departures and relocation 18+), matching the `menu(state, month)` signature.
- **Departures require three active people**, one stricter than a floor of two,
  so the org never *drops* below two.
- **`RoleChanged` walks a promotion ladder** rather than rerolling, so it never
  emits "Designer → Platform Engineer."
- **Percentages use a coarse grid, floor-scaled if over 100**, making the
  invariant structurally impossible to violate rather than checked afterward.
- **Departure cascade with deliberate orphaning.** A survivor inherits the work
  except ~30% of the time, because generating the pathology is the point.
- **The cascade preserves `roleInContext`**, so inherited work keeps its meaning.

## Validation

- **`validateLog` is an independent referee.** It shares `applyEvent` but none of
  the generator's legality logic, so it can catch generator bugs, not restate them.
- **It is a library function, not a CLI flag** — nothing in `main.ts` calls it;
  it is run directly against generated logs.
- **It returns a list rather than throwing**, so a bad log is fully diagnosed in
  one pass.

## Output

- **Prose resolves ids to names by folding alongside the render**, using state as
  it stood *before* each event, when the referenced entity is guaranteed present.
- **"Allocation set to", not "allocated to."** The vector replaces rather than
  accumulates, and the wrong verb hides a silently dropped customer.
- **Flags compose** — the timeline always prints, `--json` and `--snapshot` add to it.
- **`--snapshot` compares `YYYY-MM` lexicographically**, since ISO dates sort as
  strings and parsing would add a failure mode for nothing.
- **The snapshot folds on `effectiveDate`, not `timestamp`**, answering what was
  true rather than what was known.
- **The snapshot lists unallocated people**, who are as much a signal as
  unowned customers.

## Tooling

- **TypeScript via tsx; no build step, no runtime dependencies.** The log is the
  output, so there is nothing to compile or serve.
- **`@types/node` is the one added devDependency**, needed because the CLI reads
  `process.argv` and writes a file while the typecheck must stay clean.
- **`noUncheckedIndexedAccess` is on**, costing some ceremony around array access
  and catching the bug class this code is most exposed to.

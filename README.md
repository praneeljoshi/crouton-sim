# Org Simulator

Simulates an organization's life as an append-only event log — formation, hires,
teams, customers, allocation changes, departures — and renders that log as a
prose timeline, a JSON fixture, and a point-in-time snapshot.

## Scoping the ambiguity

**Canonical events, not system payloads.** A Workday webhook and a Jira change
are *projections* of the same underlying facts. The interesting layer is the one
they converge on, so this simulator generates that canonical stream directly. An
adapter layer would map system-specific shapes onto this taxonomy; writing the
adapters without first fixing the taxonomy would be building the wrong end.
Nine event kinds cover the org lifecycle; each carries `source` to tag which
system the fact would have come from.

**This is a fixture generator, not a toy org.** The output is meant to be fed to
something — an ingestion pipeline, a detection rule, a test. That framing decided
several things: the JSON export is the real artifact and the prose is for humans;
`effectiveDate` is separate from `timestamp` because ingestion has to cope with
effective-dating; and the generator can produce *pathologies on purpose*, not
just happy paths. An orphaned customer — signed, with nobody assigned — is a
state this simulator reaches deliberately, because detecting it is the point.

**Determinism is a requirement, not a nicety.** A fixture that changes between
runs is not a fixture. A seeded PRNG (mulberry32) drives every choice, so
`--seed 42` reproduces the same stream byte-for-byte and can be committed to CI.
No wall-clock reads, no `Math.random`, nothing non-reproducible anywhere.

**The org is the log; state is a fold.** State is never stored, only derived by
folding events through one pure `applyEvent(state, event)`. That single function
does three jobs: the generator's bookkeeping, the substrate for invariant
checking, and `snapshotAt` for free. Customer ownership is likewise derived — a
query over assignments, never a stored field — so it cannot drift from the log.

## Running it

```bash
npm install                                              # dev deps only, no runtime deps

npx tsx src/main.ts --seed 42 --months 24                # prose timeline
npx tsx src/main.ts --seed 42 --months 24 --json         # + writes events.json
npx tsx src/main.ts --seed 42 --months 24 --snapshot 2026-03   # + org state at that month
```

Flags: `--seed` (default 42), `--months` (default 24), `--json`, `--snapshot YYYY-MM`.

Timeline excerpt — a departure cascade, with the contextual role carried across:

```
May 2025 — Northwind signed as a customer.
Jun 2025 — Luis's allocation set to Northwind 25% (account lead).
Aug 2025 — Luis departed (voluntary).
Aug 2025 — Amara's allocation set to Northwind 20% (account lead).
```

Snapshot excerpt — ownership derived from assignments, orphans flagged:

```
Customers (4)
  c1   Northwind              Isaac
  c2   Acme Health            Amara, Ingrid
  c3   Meridian Bank          Ingrid
  c4   Voltaic                *** ORPHANED — no active assignments ***
```

`src/validate.ts` exports `validateLog(events)`, an independent referee that
re-folds a log and returns invariant violations — allocation sums over 100,
negative percentages, references to unhired or departed people, duplicate person
ids, allocations to unsigned customers or nonexistent teams, a first event that
isn't `CompanyFounded`, and departures preceding hires.

## What I'd build next

- **Bitemporal storage.** `effectiveDate` vs `timestamp` is the hook and it's
  already in every event, but nothing yet queries along both axes — "what did we
  *believe* the org looked like in March" is a different question from "what was
  *true* in March," and answering it means storing knowledge-time as a real
  dimension rather than a field.
- **Messiness injection.** Real streams arrive late, out of order, duplicated,
  and corrected. Emitting those deliberately is what would make this a serious
  test of an ingestion layer, since the fold is where correction semantics get
  decided.
- **System-specific emitters.** Render the canonical stream as Workday-shaped or
  Jira-shaped payloads, then run them back through an adapter and assert the
  canonical events come out unchanged — a round-trip test for the adapter layer.
- **Snapshot caching.** `snapshotAt` re-folds the entire log on every call —
  fine at 36 events, but linear per query against a log that only grows;
  periodic materialized snapshots plus a partial fold from the nearest one is
  the standard fix.

Deliberately not built, to keep the core small: persistence, an API server, a
React UI, funding and compensation events, and team or company dissolution.

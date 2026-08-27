# Org Simulator

Simulates an organization's life as an append-only event log — formation, hires,
teams, customers, allocation changes, departures — and renders that log as a
prose timeline, a JSON fixture, and a point-in-time snapshot.

```bash
npm install
npx tsx src/main.ts --seed 42 --months 24
```

## Scoping the ambiguity

**Canonical events, not system payloads.** A Workday webhook and a Jira change
are *projections* of the same underlying facts. The interesting layer is the one
they converge on, so this simulator generates that canonical stream directly. An
adapter layer would map system-specific shapes onto this taxonomy; writing the
adapters without first fixing the taxonomy would be building the wrong end.
Nine event kinds cover the org lifecycle; each carries `source` to tag which
system the fact would have come from.

**The org is the log; state is a fold.** 
State is never persisted, only derived by folding events through one pure 
`applyEvent(state, event)`. That single function does three jobs: 
the generator's bookkeeping, invariant checking, and `snapshotAt`. 
Customer ownership is likewise derived — a query over assignments, 
never a stored field — so it cannot drift from the log.

**Determinism is a requirement, not a nicety.** 
A seeded PRNG drives every choice, and timestamps derive
from a sequence counter rather than the rng, so sorting the log by timestamp
reproduces the generated order exactly. No wall-clock reads, no `Math.random`.

### A note on scope

The brief asks for small. The **core** below is that: 
the event model, the domain org model fold, seeded generation, and the three outputs. 
This generates invariant-checked, valid events through a random walk, and implements
a functional system. 

I then deliberately deepened **one** thing — how work attaches to people. Giving
work *staffing slots* and roles *eligibility* makes a third state expressible:
**partially staffed** — an account with a commercial owner and no engineer, which
looks covered in any headcount view and isn't. That's a state worth detecting 
and modelling.

The rest of the extension — tunable regimes, presets, config validation — exposes
key paramaters of the stochastic simulator to elicit different behaviors that let
us explore this expanded space with more control. 
---

## Core

What the spec asks for, with no configuration beyond a seed and a duration.

```bash
npx tsx src/main.ts --seed 42 --months 24                      # prose timeline
npx tsx src/main.ts --seed 42 --months 24 --json               # + writes events.json
npx tsx src/main.ts --seed 42 --months 24 --snapshot 2026-09   # + org state at that month
npx tsx src/main.ts --seed $RANDOM --months 36                 # a different company
```

`--seed` (default 42), `--months` (default 24), `--json`, `--snapshot YYYY-MM`.

**Prose timeline** — one line per event, self-describing:

```
Oct 2024 — Crouton founded in Charlotte, NC by Adam.
Oct 2024 — Dashiell hired as Founding Engineer.
Oct 2024 — Zola hired as Platform Engineer.
Oct 2024 — Anders hired as Data Engineer.
```

**The departure cascade** — someone leaves, and their customer work is either
handed to a survivor or deliberately left stranded:

```
Feb 2026 — Anders departed (voluntary).
Feb 2026 — Greta's allocation set to Halcyon Insurance 10% (data integration), Meridian Bank 10% (data integration).
```

**`--json`** writes the full event log to `events.json`, pretty-printed — the
ingestion-fixture artifact. Note `timestamp` falls in the month *before*
`effectiveDate`: recorded in September, effective October 1.

**`--snapshot YYYY-MM`** folds every event effective on or before that month and
prints the org at that moment: company, active people with roles, teams with
members, customers with derived ownership, and the allocation table.

Seeds vary the company; each seed is exactly reproducible:

```
seed  3: 110 events, 24 people, 13 customers, 4 teams,  7 departures
seed 17: 131 events, 34 people, 11 customers, 6 teams,  6 departures
seed 88: 113 events, 27 people,  7 customers, 6 teams, 10 departures
```

---

## Extension

### Staffing slots and role eligibility

Each customer and internal project declares the contextual roles it needs; each
role declares which it can fill; an assignment names the slot it fills via
`roleInContext`. A person may only take a slot their role is eligible for.

```ts
{ id: "c1", name: "Northwind", needs: ["account lead", "FDE support", "data integration"] }
"Forward Deployed Engineer": { fills: ["FDE support", "onboarding"], promotesTo: "Lead Forward Deployed Engineer" }
```

Open slots are derived, never stored, so a departure reopens its slots with no
bookkeeping — and the snapshot names what is *missing*, not only what is present:

```
Customers (10)
  c1   Northwind              [3/3]  Anouk (data integration), Caleb (FDE support), Saoirse (account lead)
  c3   Meridian Bank          [4/4]  Rosa (FDE support), Saoirse (account lead), Greta (data integration), Cyrus (technical lead)
```

### Tunable regimes

A run is a sequence of parameter sets. Six levers, each an absolute rate rather
than a share of a fixed activity budget, so every number means something alone:

```ts
hiring            // expected new hires per month
attrition         // monthly probability each person leaves
deals             // expected new customers per month
staffing          // expected staffing decisions per month
internalProjects  // how many internal efforts the org runs
orphanRate        // P(work stranded by a departure is left unclaimed)
```

Regimes can be sequenced to produce a story, a simple concept that makes this
useful for simulating different types of orgs. Three ship as presests:

| `--preset` | Arc | Character |
|---|---|---|
| `balanced` *(default)* | formation → growth → steady | grows, then plateaus and holds |
| `startup` | formation → growth → **scale** | keeps compounding; drops balls at the edges |
| `understaffed` | formation → **delivery-starved** | sells far faster than it staffs |

```bash
npx tsx src/main.ts --seed 42 --months 24 --preset startup --snapshot 2026-09
npx tsx src/main.ts --seed 42 --months 24 --preset understaffed --snapshot 2026-09
npx tsx src/main.ts --seed 42 --months 24 --growth 2 --churn 0.5
```

The startup arc compounds visibly — headcount, teams, customers, and staffed
work all climb together, and partial staffing appears as the org outgrows its
ability to cover everything:

```
month     phase       people  teams  customers  assignments
2025-03   founding        12      2          2            9
2025-09   growth          18      3          5           18
2026-03   growth          31      6         15           30
2026-09   scale           39      7         24           51
```

### Demo: one company, two regimes

The clearest thing this build does — same seed, one flag, healthy org versus the
pathology the product exists to surface:

```bash
npx tsx src/main.ts --seed 42 --months 24 --snapshot 2026-09
npx tsx src/main.ts --seed 42 --months 24 --preset understaffed --snapshot 2026-09
```

```
--preset balanced                             --preset understaffed
  c1  Northwind      [3/3]  fully staffed       c1  Northwind      [1/3]  Lior (account lead)
  c2  Acme Health    [2/2]  fully staffed                                 UNSTAFFED: FDE support, data integration
  c3  Meridian Bank  [4/4]  fully staffed       c2  Acme Health    [0/2]  *** ORPHANED ***
                                                c3  Meridian Bank  [0/4]  *** ORPHANED ***
```

### Validation

`src/check.ts` is the whole validation layer: one function, one shape, one list
of problems. Sections run only if their input is supplied, and it **never
generates** — the caller supplies runs, so the checker judges independently.

```ts
import { check } from "./src/check";

check({ model })                    // taxonomy — what the CLI runs at startup
check({ runs: [events] })           // a log you were handed
check({ model, scenario, runs })    // everything
```

**Showing it has teeth** — delete one `Math.min(..., headroom)` from
`generate.ts` and the generator emits an invalid log without noticing:

```
1. Does the generator notice?  It ran fine: 106 events, no error thrown.
2. Is the output actually broken?  Yes — Saoirse is allocated 105%.
3. Does check notice?  run 0 #44 e45 AllocationChanged: allocation sums to 105, exceeds 100
```

The generator keeps the output valid. `check` tell us if it stopped being valid.

---

## What I'd build next
- **Better Dials, Data Models** Learn what kind of strategic dials and org shapes
are more realistic for Ops leadership to think in, use those as the parameter set for the sim
- **System-specific emitters.** Render the canonical stream as Workday-shaped or
  Jira-shaped payloads, run them back through an adapter, and assert the
  canonical events come out unchanged — a round-trip test for the adapter layer.
- **Snapshot caching.** `snapshotAt` re-folds the entire log on every call — fine
  at ~120 events, linear per query against a log that only grows.

Deliberately not built: persistence, an API server, a React UI, funding and
compensation events, and team or company dissolution.

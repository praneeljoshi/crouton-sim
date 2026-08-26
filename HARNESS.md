# HARNESS.md — Build Protocol

You are implementing the org simulator specified in SPEC.md. Read SPEC.md fully
before starting. This file defines HOW to build it: staged, gated, minimal.

## Rules (non-negotiable)

1. **Work one stage at a time, in order.** Complete every substep in the stage.
2. **STOP at the end of each stage.** Run the stage's validation, show me the
   result, and ask: "Stage N validated — proceed to Stage N+1?" Do not continue
   without my explicit approval.
3. **No scope creep.** Do not add any file, dependency, type, event kind, CLI
   flag, feature, or abstraction not listed in SPEC.md or this harness. If you
   believe something is missing, STOP and ask — do not build it.
4. **No dependencies** beyond `typescript` and `tsx` (dev). No runtime packages.
5. **Small and boring wins.** Prefer the obvious implementation. Every line must
   be explainable in one sentence.
6. If a validation fails, fix within the current stage. Never patch a prior
   stage's problem inside a later stage.

---

## Stage 1 — Types & Fold

- [ ] 1.1 `src/types.ts`: `Event` discriminated union — all 9 kinds exactly as
      specced in SPEC.md, with `Base` fields (eventId, timestamp, effectiveDate,
      source). No extra event kinds. No extra fields.
- [ ] 1.2 `src/types.ts`: `State` interfaces — Company, Person, Team,
      Membership, Customer, Assignment (polymorphic target), and the top-level
      `State` container.
- [ ] 1.3 `src/apply.ts`: `emptyState(): State`.
- [ ] 1.4 `src/apply.ts`: `applyEvent(state: State, event: Event): State` —
      one case per event kind. Pure function. PersonDeparted sets `departedAt`
      (never deletes) and drops that person's assignments. AllocationChanged
      replaces the person's full assignment vector.

**Validation 1:** `npx tsc --noEmit` passes with zero errors. Show the command
output. Confirm each of the 9 event kinds has a case in applyEvent. STOP.

---

## Stage 2 — Generation Engine

- [ ] 2.1 `src/rng.ts`: `mulberry32(seed: number): () => number` (inline the
      standard implementation) and `weightedPick<T>(rng, items: [T, number][]): T`.
- [ ] 2.2 `src/generate.ts`: payload builders — one small function per event
      kind that constructs a valid event from current state + rng (random
      active person for departures; 1–3 existing targets with percentages
      normalized to sum ≤ 100 for allocations; names from a hardcoded list of
      ~30; sequential ids like p1, t1, c1).
- [ ] 2.3 `src/generate.ts`: `menu(state, month)` — legal candidate events with
      weights, per SPEC.md heuristics: hiring-heavy early phase, customers and
      allocation churn mid, rising departures late. Conditions enforce legality
      (no TeamFormed before 4 people, no CustomerSigned before a team exists,
      no departures below 2 active people, etc.).
- [ ] 2.4 `src/generate.ts`: `generate(seed: number, months: number): Event[]` —
      first event CompanyFounded; then loop months, 0–3 events per month drawn
      from the menu; maintain running state via applyEvent; departure cascade:
      when a person with customer assignments departs, either emit
      AllocationChanged reassigning a survivor OR deliberately leave the
      customer orphaned (rng-chosen, ~30% orphan).
- [ ] 2.5 `src/validate.ts`: `validateLog(events: Event[]): string[]` — an
      independent referee that folds the log and returns violations: allocation
      sum > 100; event references a person not yet hired or already departed;
      allocation targets a customer/team that does not exist; first event not
      CompanyFounded; any departedAt < hiredAt.

**Validation 2:** A scratch run (`npx tsx`) shows: (a) `generate(42, 24)`
returns a non-empty event array; (b) `validateLog` returns ZERO violations on
it; (c) two calls with seed 42 produce identical streams (print both lengths
and a hash or JSON equality). Show the output. STOP.

---

## Stage 3 — CLI & Outputs

- [ ] 3.1 `src/main.ts`: parse flags from process.argv by hand — `--seed`
      (default 42), `--months` (default 24), `--json`, `--snapshot YYYY-MM`.
      No argument-parsing library.
- [ ] 3.2 Prose timeline (default output): one line per event in the style of
      the SPEC example — "Oct 2024 — Crouton founded in Charlotte, NC by
      Adam." / "May 2026 — Breno hired as founding designer (Design)." Use the
      from/to fields so lines are self-describing.
- [ ] 3.3 `--json`: write the full event log to `events.json`, pretty-printed.
- [ ] 3.4 `--snapshot YYYY-MM`: fold events with effectiveDate ≤ the given
      month and print the org at that moment: company, active people with
      roles, teams with members, customers, and an allocation table (person ×
      target × pct). Flag any orphaned customers (signed, zero assignments).

**Validation 3:** Run and show output of all three:
(a) `npx tsx src/main.ts --seed 42 --months 24`
(b) `npx tsx src/main.ts --seed 42 --months 24 --json` (show first 2 events of
    events.json)
(c) `npx tsx src/main.ts --seed 42 --months 24 --snapshot 2026-03`
Output must be readable and the snapshot must be consistent with the timeline
above it. STOP.

---

## Stage 4 — README & Explanation Pack

- [ ] 4.1 `README.md`, one page: (top) how the ambiguity was scoped — canonical
      events as the layer real system payloads project onto; fixture-generator
      framing; determinism as a requirement. (middle) install/run instructions
      with the three example commands and a short sample of output. (bottom)
      "What I'd build next": bitemporal storage, messiness injection
      (late/corrected/duplicate events), system-specific emitters
      (Workday/Jira-shaped), snapshot caching at scale. Nothing else.
- [ ] 4.2 `DECISIONS.md`: a bullet list of every design decision present in the
      code, each with its one-sentence rationale — for my video prep. At
      minimum: event sourcing / log-as-truth; full assignment vector (not
      diffs); derive-don't-store (ownership as query, snapshots computed);
      validation at the write side; seeded determinism / no AI in the artifact;
      effectiveDate vs timestamp; departure cascade with deliberate orphaning.

**Validation 4:** I can read both files in under 4 minutes and nothing in them
references anything not actually in the code. STOP. Build is complete — do not
add anything further.

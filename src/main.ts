import { writeFileSync } from "node:fs";
import { applyEvent, emptyState } from "./apply";
import { generate } from "./generate";
import { DEFAULT_MODEL, needsOf, workNameOf } from "./model";
import { DEFAULT_SCENARIO, SCENARIOS, scaleScenario } from "./scenario";
import type { Scenario } from "./scenario";
import { check } from "./check";
import type { Event, State, Target } from "./types";

/** One model, used for both generation and rendering — a single source of names. */
const model = DEFAULT_MODEL;

// --- Flag parsing: by hand, no library ---

type Options = {
  seed: number;
  months: number;
  json: boolean;
  snapshot: string | null;
  scenario: Scenario;
  growth: number;
  churn: number;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    seed: 42,
    months: 24,
    json: false,
    snapshot: null,
    scenario: DEFAULT_SCENARIO,
    growth: 1,
    churn: 1,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--seed":
      case "--months":
      case "--growth":
      case "--churn": {
        const n = Number(value);
        if (value === undefined || !Number.isFinite(n)) die(`${flag} needs a number`);
        if (flag === "--seed") options.seed = n;
        else if (flag === "--months") options.months = n;
        else if (flag === "--growth") options.growth = n;
        else options.churn = n;
        i++;
        break;
      }
      case "--json":
        options.json = true;
        break;
      case "--snapshot":
        if (value === undefined || !/^\d{4}-\d{2}$/.test(value)) die("--snapshot needs YYYY-MM");
        options.snapshot = value!;
        i++;
        break;
      case "--preset": {
        const scenario = value === undefined ? undefined : SCENARIOS[value];
        if (scenario === undefined) {
          die(`--preset must be one of: ${Object.keys(SCENARIOS).join(", ")}`);
        }
        options.scenario = scenario;
        i++;
        break;
      }
      default:
        die(`unknown flag ${flag}`);
    }
  }
  return options;
}

function die(message: string): never {
  console.error(`error: ${message}`);
  console.error("usage: tsx src/main.ts [--seed N] [--months N] [--growth N] [--churn N] [--json] [--snapshot YYYY-MM] [--preset NAME]");
  process.exit(1);
}

// --- Name resolution: the log stores ids, humans read names ---

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2024-10-01" -> "Oct 2024" */
function monthLabel(effectiveDate: string): string {
  const [year, month] = effectiveDate.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

const personName = (s: State, id: string) => s.people.find((p) => p.id === id)?.name ?? id;
const teamName = (s: State, id: string) => s.teams.find((t) => t.id === id)?.name ?? id;

function targetName(state: State, target: Target): string {
  if (target.kind === "customer") {
    return state.customers.find((c) => c.id === target.id)?.name ?? target.id;
  }
  return workNameOf(model, target);
}

// --- 3.2 Prose timeline ---

/** Render one event against the state as it stood just before the event. */
function proseFor(before: State, event: Event): string {
  switch (event.kind) {
    case "CompanyFounded":
      return `${event.name} founded in ${event.location} by ${event.founder}.`;
    case "CompanyRelocated":
      return `${before.company?.name ?? "The company"} relocated from ${event.from} to ${event.to}.`;
    case "PersonHired": {
      const notes = [
        ...(event.teamId === undefined ? [] : [teamName(before, event.teamId)]),
        ...(event.employmentType === "full_time" ? [] : [event.employmentType.replace("_", "-")]),
      ];
      return `${event.name} hired as ${event.role}${notes.length ? ` (${notes.join(", ")})` : ""}.`;
    }
    case "PersonDeparted":
      return `${personName(before, event.personId)} departed (${event.reason}).`;
    case "RoleChanged":
      return `${personName(before, event.personId)} moved from ${event.from} to ${event.to}.`;
    case "TeamFormed":
      return `${event.name} team formed.`;
    case "PersonTransferred": {
      const who = personName(before, event.personId);
      const to = teamName(before, event.toTeamId);
      return event.fromTeamId === null
        ? `${who} joined ${to}.`
        : `${who} transferred from ${teamName(before, event.fromTeamId)} to ${to}.`;
    }
    case "CustomerSigned":
      return `${event.name} signed as a customer.`;
    case "AllocationChanged": {
      const who = personName(before, event.personId);
      if (event.assignments.length === 0) return `${who}'s allocation cleared.`;
      const parts = event.assignments.map((a) => {
        const context = a.roleInContext === undefined ? "" : ` (${a.roleInContext})`;
        return `${targetName(before, a.target)} ${a.pct}%${context}`;
      });
      // "set to", not "allocated to": the vector replaces, it does not accumulate.
      return `${who}'s allocation set to ${parts.join(", ")}.`;
    }
  }
}

function printTimeline(events: Event[]): void {
  let state = emptyState();
  for (const event of events) {
    console.log(`${monthLabel(event.effectiveDate)} — ${proseFor(state, event)}`);
    state = applyEvent(state, event);
  }
}

// --- 3.4 Snapshot ---

/** Fold every event effective on or before the given month. Demonstrates the fold. */
function snapshotAt(events: Event[], month: string): State {
  return events
    .filter((e) => e.effectiveDate.slice(0, 7) <= month)
    .reduce(applyEvent, emptyState());
}

function printSnapshot(state: State, month: string): void {
  const active = state.people.filter((p) => p.departedAt === undefined);
  console.log(`\n=== Snapshot: ${month} ===\n`);

  if (state.company === null) {
    console.log("No company yet.");
    return;
  }
  console.log(`Company    ${state.company.name} — ${state.company.location} (founded ${state.company.foundedAt})`);
  console.log(`Headcount  ${active.length} active, ${state.people.length - active.length} departed`);

  console.log(`\nPeople (${active.length})`);
  for (const p of active) {
    const teams = state.memberships
      .filter((m) => m.personId === p.id)
      .map((m) => teamName(state, m.teamId));
    const type = p.employmentType === "full_time" ? "" : ` [${p.employmentType.replace("_", "-")}]`;
    console.log(`  ${p.id.padEnd(4)} ${p.name.padEnd(9)} ${p.role}${type}${teams.length ? ` — ${teams.join(", ")}` : ""}`);
  }

  console.log(`\nTeams (${state.teams.length})`);
  for (const t of state.teams) {
    const members = state.memberships
      .filter((m) => m.teamId === t.id)
      .map((m) => state.people.find((p) => p.id === m.personId))
      .filter((p) => p !== undefined && p.departedAt === undefined)
      .map((p) => p!.name);
    console.log(`  ${t.id.padEnd(4)} ${t.name.padEnd(18)} ${members.length ? members.join(", ") : "(no active members)"}`);
  }

  // Ownership is derived here, not stored. Slot counts distinguish the three
  // states that matter: fully staffed, partially staffed, and orphaned.
  console.log(`\nCustomers (${state.customers.length})`);
  for (const c of state.customers) {
    const needs = needsOf(model, { kind: "customer", id: c.id });
    const rows = state.assignments.filter(
      (a) => a.target.kind === "customer" && a.target.id === c.id,
    );
    const filled = needs.filter((n) => rows.some((a) => a.roleInContext === n));
    const missing = needs.filter((n) => !filled.includes(n));

    // One entry per person, listing every slot they hold on this account.
    const bySlotHolder = new Map<string, string[]>();
    for (const a of rows) {
      const who = personName(state, a.personId);
      const slots = bySlotHolder.get(who) ?? [];
      if (a.roleInContext !== undefined) slots.push(a.roleInContext);
      bySlotHolder.set(who, slots);
    }
    const owners = [...bySlotHolder.entries()]
      .map(([who, slots]) => (slots.length > 0 ? `${who} (${slots.join(", ")})` : who))
      .join(", ");

    const ratio = `[${filled.length}/${needs.length}]`;
    console.log(
      `  ${c.id.padEnd(4)} ${c.name.padEnd(22)} ${ratio.padEnd(6)} ` +
        `${rows.length > 0 ? owners : "*** ORPHANED — no active assignments ***"}`,
    );
    if (rows.length > 0 && missing.length > 0) {
      console.log(`  ${"".padEnd(4)} ${"".padEnd(22)} ${"".padEnd(6)} UNSTAFFED: ${missing.join(", ")}`);
    }
  }

  console.log(`\nAllocations (${state.assignments.length} rows)`);
  console.log(`  ${"PERSON".padEnd(12)} ${"TARGET".padEnd(28)} ${"PCT".padStart(4)}  CONTEXT`);
  for (const p of active) {
    for (const a of state.assignments.filter((x) => x.personId === p.id)) {
      const target = `${a.target.kind}: ${targetName(state, a.target)}`;
      console.log(`  ${p.name.padEnd(12)} ${target.padEnd(28)} ${`${a.pct}%`.padStart(4)}  ${a.roleInContext ?? ""}`);
    }
  }

  const idle = active.filter((p) => !state.assignments.some((a) => a.personId === p.id));
  if (idle.length > 0) console.log(`\n  Unallocated: ${idle.map((p) => p.name).join(", ")}`);
}

// --- Entry point ---

const options = parseArgs(process.argv.slice(2));

// Refuse to generate from a broken taxonomy: its output would be pathologies
// indistinguishable from real ones. Silent when the model is sound.
const scenario = scaleScenario(options.scenario, options.growth, options.churn);
const configProblems = check({ model, scenario });
if (configProblems.length > 0) die(`invalid configuration:\n  ${configProblems.join("\n  ")}`);

const events = generate(options.seed, options.months, model, scenario);

printTimeline(events);

if (options.json) {
  writeFileSync("events.json", `${JSON.stringify(events, null, 2)}\n`);
  console.log(`\nWrote ${events.length} events to events.json`);
}

if (options.snapshot !== null) {
  printSnapshot(snapshotAt(events, options.snapshot), options.snapshot);
}

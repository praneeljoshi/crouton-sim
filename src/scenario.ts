/**
 * The tuning levers.
 *
 * Every rate is an absolute frequency, not a share of some fixed activity
 * budget: `hiring: 2` means two hires a month, whatever else is going on.
 * Total event volume is a consequence of the org's behaviour rather than a
 * number someone dialled in, so a busy org is busy because more is happening.
 *
 * These four drivers — growth, churn, deals, internal work — are what a regime
 * is. Team formation, promotions, and transfers are consequences of them and
 * are derived in the generator, not configured here.
 */
export type SimParams = {
  /** Expected new hires per month. */
  hiring: number;
  /** Monthly probability that any given person leaves. */
  attrition: number;
  /** Expected new customers per month. */
  deals: number;
  /** Expected staffing decisions per month, capped by how much work is open. */
  staffing: number;
  /** How many internal efforts the org runs concurrently — internal work demand. */
  internalProjects: number;
  /** Probability that work stranded by a departure is left unclaimed. */
  orphanRate: number;
};

// --- Regimes: named parameter sets, nothing more ---

/** Formation: hiring dominates, nobody leaves yet, mostly internal work. */
export const FORMATION: SimParams = {
  hiring: 2.5,
  attrition: 0,
  deals: 0.3,
  staffing: 1.5,
  internalProjects: 3,
  orphanRate: 0.15,
};

/** Growth: customers arrive and get staffed, attrition begins. */
export const GROWTH: SimParams = {
  hiring: 1.2,
  attrition: 0.02,
  deals: 0.8,
  staffing: 2.5,
  internalProjects: 4,
  orphanRate: 0.15,
};

/** Steady: attrition is real but backfilled, so headcount holds. */
export const STEADY: SimParams = {
  hiring: 0.6,
  attrition: 0.035,
  deals: 0.4,
  staffing: 2,
  internalProjects: 4,
  orphanRate: 0.2,
};

/**
 * Scale-up: hiring and selling both accelerate, platform investment grows, and
 * staffing runs hard to keep up. Unlike STEADY this is not a plateau — the org
 * is still compounding, and things get dropped at the edges because of it.
 */
export const SCALE: SimParams = {
  hiring: 2.5,
  attrition: 0.03,
  deals: 1.5,
  staffing: 3.5,
  internalProjects: 6,
  orphanRate: 0.2,
};

/** Sales outruns delivery: deals close faster than anyone can be staffed. */
export const DELIVERY_STARVED: SimParams = {
  hiring: 0.6,
  attrition: 0.02,
  deals: 0.8,
  staffing: 0.5,
  internalProjects: 2,
  orphanRate: 0.5,
};

// --- Scenarios: a run is a sequence of parameter sets ---

export type Segment = { until: number; params: SimParams };
export type Scenario = { name: string; timeline: Segment[] };

/** The classic arc. */
export const BALANCED: Scenario = {
  name: "balanced",
  timeline: [
    { until: 0.25, params: FORMATION },
    { until: 0.75, params: GROWTH },
    { until: 1, params: STEADY },
  ],
};

/**
 * A startup arc: a short founding stretch with no customers and no attrition,
 * a long growth stretch where the commercial motion starts, then scale-up where
 * headcount, deals, and internal investment all compound at once.
 */
export const STARTUP: Scenario = {
  name: "startup",
  timeline: [
    { until: 0.2, params: FORMATION },
    { until: 0.6, params: GROWTH },
    { until: 1, params: SCALE },
  ],
};

/** Forms normally, then never staffs what it sells. The pathological fixture. */
export const UNDERSTAFFED: Scenario = {
  name: "understaffed",
  timeline: [
    { until: 0.25, params: { ...FORMATION, staffing: 0.6 } },
    { until: 1, params: DELIVERY_STARVED },
  ],
};

// --- Experimental: kept for reference, not exposed via --preset ---
//
// These exercise regime sequencing further than the deliverable needs. They
// work; they are commented out to keep the shipped surface to the two that
// matter — a functional org and a pathological one.
//
// /** Contraction: heavy departures, hiring stops, handoffs get dropped. */
// export const CRISIS: SimParams = {
//   hiring: 0.1, attrition: 0.12, deals: 0.15,
//   staffing: 1, internalProjects: 3, orphanRate: 0.5,
// };
//
// /** Attrition from month zero, rising steeply. */
// export const HIGH_CHURN: Scenario = {
//   name: "high-churn",
//   timeline: [
//     { until: 0.25, params: { ...FORMATION, attrition: 0.03 } },
//     { until: 0.75, params: { ...GROWTH, attrition: 0.06 } },
//     { until: 1, params: { ...STEADY, attrition: 0.1 } },
//   ],
// };
//
// /** Grows, then contracts hard — the regime change is the point. */
// export const BOOM_BUST: Scenario = {
//   name: "boom-bust",
//   timeline: [
//     { until: 0.2, params: FORMATION },
//     { until: 0.6, params: GROWTH },
//     { until: 1, params: CRISIS },
//   ],
// };

export const DEFAULT_SCENARIO: Scenario = BALANCED;

export const SCENARIOS: Record<string, Scenario> = {
  balanced: BALANCED,
  startup: STARTUP,
  understaffed: UNDERSTAFFED,
};

/** Which parameters govern this month, by fraction of the run. */
export function paramsAt(
  scenario: Scenario,
  month: number,
  months: number,
): SimParams | undefined {
  const progress = months <= 0 ? 1 : (month + 1) / months;
  return (scenario.timeline.find((s) => progress <= s.until) ?? scenario.timeline.at(-1))
    ?.params;
}

/**
 * The specced global dials, applied across every segment: `--growth 2` means
 * this org hires twice as hard throughout, whichever regime is in force.
 */
export function scaleScenario(scenario: Scenario, growth: number, churn: number): Scenario {
  if (growth === 1 && churn === 1) return scenario;
  return {
    name: scenario.name,
    timeline: scenario.timeline.map(({ until, params }) => ({
      until,
      params: { ...params, hiring: params.hiring * growth, attrition: params.attrition * churn },
    })),
  };
}

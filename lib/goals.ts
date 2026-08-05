// Daily calling goals. In their own module so lib/pace and DailyStats can
// both import them without a circular dependency.
//
// Per-person: 60. Team: two callers × 60. The ±1 rule (see lib/pace
// todaysTarget) scales with whichever goal applies.

export const GOAL = 60
export const TEAM_GOAL = 120

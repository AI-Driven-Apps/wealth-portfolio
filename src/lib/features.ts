// Every module is a feature flag. Visible = on globally AND granted to the user
// (admins need only the global switch). Phase marks what is built so far.
export const FEATURES = [
  { key: "mf", label: "Mutual funds", phase: 2, built: true },
  { key: "sip", label: "SIPs", phase: 2, built: true },
  { key: "fof", label: "Fund of funds", phase: 2, built: true },
  { key: "equity", label: "Equity", phase: 3, built: true },
  { key: "etf", label: "ETFs", phase: 3, built: true },
  { key: "imports", label: "Statement imports", phase: 2, built: true },
  { key: "lookthrough", label: "Look-through allocation", phase: 4, built: false },
  { key: "other", label: "Fixed income & alternatives", phase: 5, built: false },
  { key: "loans", label: "Loans & EMIs", phase: 5, built: false },
  { key: "what_if", label: "What-if comparison", phase: 6, built: false },
  { key: "drift", label: "Target allocation & drift alerts", phase: 6, built: false },
  { key: "discord_user", label: "Personal Discord alerts", phase: 6, built: false },
  { key: "ai_agents", label: "AI agents (Pi only)", phase: 7, built: false },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];

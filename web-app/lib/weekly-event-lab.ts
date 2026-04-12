export type EventKind = "macro" | "commodity" | "earnings";

export type ScoreBreakdown = {
  marketImpact: number;
  tickerSensitivity: number;
  asymmetry: number;
  liquidity: number;
  confidence: number;
  composite: number;
};

export type WatchlistGroup = {
  name: string;
  note: string;
  tickers: string[];
};

export type EventLegSeed = {
  type: "call" | "put";
  distancePct: number;
  premium: number;
  contracts: number;
  dte: number;
  label: string;
  thesis: string;
};

export type PortfolioLegSeed = EventLegSeed & {
  symbol: string;
};

export type EventScenario = {
  name: string;
  movePct: number;
  probability: number;
  note: string;
};

export type PortfolioScenario = {
  name: string;
  probability: number;
  note: string;
  moves: Record<string, number>;
};

export type TickerProfile = {
  symbol: string;
  label: string;
  driver: string;
  seedSpot: number;
  impliedMovePct: number;
  scenarioFocus: string;
  legSeeds: EventLegSeed[];
  scenarios: EventScenario[];
};

export type EventCandidate = {
  id: string;
  title: string;
  kind: EventKind;
  scope: string;
  eventDate: string;
  eventLabel: string;
  timeLabel: string;
  summary: string;
  whyItMatters: string;
  marketProxy: string;
  ranking: ScoreBreakdown;
  tags: string[];
  watchlistTickers: string[];
  primarySymbol: string;
  scenarioPlanningNote: string;
  dataChecklist: string[];
  tickerProfiles: TickerProfile[];
  portfolioLegSeeds: PortfolioLegSeed[];
  portfolioScenarios: PortfolioScenario[];
};

export type PlannerLeg = {
  id: number;
  symbol: string;
  type: "call" | "put";
  strike: number;
  premium: number;
  contracts: number;
  dte: number;
  label: string;
  thesis: string;
};

export type WeeklyScanSnapshot = {
  generatedAt: string;
  weekLabel: string;
  weekRangeLabel: string;
  notes: string[];
  topThemes: string[];
  watchlist: WatchlistGroup[];
  events: EventCandidate[];
};

type EventTemplate = Omit<EventCandidate, "eventDate" | "eventLabel" | "ranking"> & {
  dayOffset: number;
  ranking: Omit<ScoreBreakdown, "composite">;
};

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function mondayOfWeek(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
}

function getScanWeekStart(now = new Date()) {
  const day = now.getDay();
  if (day === 0 || day >= 5) return addDays(mondayOfWeek(now), 7);
  return mondayOfWeek(now);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDay(date: Date) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function compositeScore(ranking: Omit<ScoreBreakdown, "composite">, watchlistCoverage: number, kind: EventKind) {
  const kindBonus = { macro: 4, commodity: 3, earnings: 2 }[kind] ?? 0;
  const weightedBase =
    ranking.marketImpact * 0.34 +
    ranking.tickerSensitivity * 0.24 +
    ranking.asymmetry * 0.2 +
    ranking.liquidity * 0.12 +
    ranking.confidence * 0.1;
  const uncertaintyPenalty = (100 - ranking.confidence) * 0.18;
  return Math.round(
    Math.min(
      100,
      18 +
        weightedBase * 0.68 +
        Math.min(watchlistCoverage * 1.2, 6) +
        kindBonus -
        uncertaintyPenalty,
    ),
  );
}

function roundStrike(raw: number, spot: number) {
  const increment = spot >= 300 ? 1 : 0.5;
  return Math.round(raw / increment) * increment;
}

export function buildStarterLegs(profile: TickerProfile, spot = profile.seedSpot): PlannerLeg[] {
  return profile.legSeeds.map((seed, index) => {
    const rawStrike = seed.type === "call" ? spot * (1 + seed.distancePct / 100) : spot * (1 - seed.distancePct / 100);
    return {
      id: index + 1,
      symbol: profile.symbol,
      type: seed.type,
      strike: roundStrike(rawStrike, spot),
      premium: seed.premium,
      contracts: seed.contracts,
      dte: seed.dte,
      label: seed.label,
      thesis: seed.thesis,
    };
  });
}

export function buildPortfolioStarterLegs(event: EventCandidate, spotBySymbol?: Record<string, number>): PlannerLeg[] {
  const profileBySymbol = new Map(event.tickerProfiles.map((profile) => [profile.symbol, profile]));

  return event.portfolioLegSeeds.map((seed, index) => {
    const seedSpot = spotBySymbol?.[seed.symbol] ?? profileBySymbol.get(seed.symbol)?.seedSpot ?? 100;
    const rawStrike =
      seed.type === "call" ? seedSpot * (1 + seed.distancePct / 100) : seedSpot * (1 - seed.distancePct / 100);

    return {
      id: index + 1,
      symbol: seed.symbol,
      type: seed.type,
      strike: roundStrike(rawStrike, seedSpot),
      premium: seed.premium,
      contracts: seed.contracts,
      dte: seed.dte,
      label: seed.label,
      thesis: seed.thesis,
    };
  });
}

export function estimateOptionPrice(
  type: "call" | "put",
  strike: number,
  premium: number,
  dte: number,
  spotAtEvent: number,
  currentSpot: number,
) {
  const intrinsic = type === "call" ? Math.max(0, spotAtEvent - strike) : Math.max(0, strike - spotAtEvent);
  if (dte <= 2) return Math.max(intrinsic, 0.01);
  const moveSize = Math.abs(spotAtEvent - currentSpot) / currentSpot;
  const inFavor = (type === "call" && spotAtEvent > currentSpot) || (type === "put" && spotAtEvent < currentSpot);
  const ivBump = inFavor ? 1 + moveSize * 4 : 1 - moveSize * 2;
  const timeRemaining = Math.max((dte - 1) / dte, 0.1);
  const timeValue = premium * 0.45 * timeRemaining * Math.max(ivBump, 0.2);
  return Math.max(intrinsic + timeValue, 0.02);
}

const WATCHLIST: WatchlistGroup[] = [
  {
    name: "Core quality",
    note: "Liquid leaders and durable businesses.",
    tickers: ["MSFT", "META", "AMZN", "NVDA", "AVGO", "XOM", "JPM", "LLY"],
  },
  {
    name: "Macro vehicles",
    note: "Cleanest places to express broad event risk.",
    tickers: ["SPY", "QQQ", "IWM", "XLE", "SMH", "XLF", "XBI"],
  },
  {
    name: "Satellite beta",
    note: "Smaller, punchier names for selective asymmetry.",
    tickers: ["AMD", "PLTR", "SOFI", "RKLB", "MRNA"],
  },
];

const EVENT_TEMPLATES: EventTemplate[] = [
  {
    id: "inflation-reset",
    title: "Inflation Reset Checkpoint",
    kind: "macro",
    scope: "Rates, index breadth, and second-order sector reactions",
    dayOffset: 1,
    timeLabel: "08:30 ET",
    summary: "A single print can reprice rates, breadth, and short-dated implieds in the first hour.",
    whyItMatters: "Index options stay the cleanest expression, but laggards often offer the better asymmetry once the open settles.",
    marketProxy: "SPY / QQQ / TNX",
    tags: ["macro", "rates", "index", "laggard"],
    watchlistTickers: ["SPY", "QQQ", "IWM", "SMH"],
    primarySymbol: "SPY",
    scenarioPlanningNote: "Use Monday's scan to shortlist this setup, then replace the starter premiums with live numbers once the first move hits.",
    dataChecklist: ["Consensus versus whisper", "Front-week ATM implied move", "First 30-minute realized move", "TNX confirmation"],
    portfolioLegSeeds: [
      { symbol: "SPY", type: "call", distancePct: 1.1, premium: 2.35, contracts: 2, dte: 7, label: "Relief call", thesis: "Cool print broad bid" },
      { symbol: "QQQ", type: "call", distancePct: 1.6, premium: 3.05, contracts: 2, dte: 7, label: "Beta relief call", thesis: "Lower yields hit duration" },
      { symbol: "SMH", type: "call", distancePct: 2.4, premium: 2.45, contracts: 1, dte: 7, label: "Semi kicker call", thesis: "AI squeeze extension" },
      { symbol: "SPY", type: "put", distancePct: 1.0, premium: 2.18, contracts: 2, dte: 3, label: "Hot print put", thesis: "Risk-off repricing" },
      { symbol: "QQQ", type: "put", distancePct: 1.4, premium: 2.9, contracts: 2, dte: 3, label: "Duration put", thesis: "Growth gets hit first" },
      { symbol: "SMH", type: "put", distancePct: 2.1, premium: 2.3, contracts: 1, dte: 3, label: "Semi hedge put", thesis: "Higher beta downside kicker" },
    ],
    portfolioScenarios: [
      { name: "Cool print relief", probability: 27, note: "Rates ease and breadth expands.", moves: { SPY: 2.4, QQQ: 3.1, SMH: 4.2 } },
      { name: "Inline / churn", probability: 24, note: "Initial move fades into a slower session.", moves: { SPY: 0.7, QQQ: 0.9, SMH: 1.1 } },
      { name: "Sticky inflation flush", probability: 29, note: "Indices gap lower as rates reprice.", moves: { SPY: -2.1, QQQ: -2.8, SMH: -3.4 } },
      { name: "Rates shock trend day", probability: 20, note: "Downside trend day with vol expansion.", moves: { SPY: -3.5, QQQ: -4.2, SMH: -5.0 } },
    ],
    ranking: { marketImpact: 98, tickerSensitivity: 88, asymmetry: 85, liquidity: 99, confidence: 82 },
    tickerProfiles: [
      {
        symbol: "SPY",
        label: "SPY | cleanest macro vehicle",
        driver: "Rates and breadth",
        seedSpot: 525,
        impliedMovePct: 1.5,
        scenarioFocus: "Balanced binary with cleaner fills after the first impulse.",
        legSeeds: [
          { type: "call", distancePct: 1.2, premium: 2.45, contracts: 2, dte: 7, label: "Relief call", thesis: "Cool print squeeze" },
          { type: "call", distancePct: 2.4, premium: 1.12, contracts: 2, dte: 7, label: "Tail call", thesis: "Trend day higher" },
          { type: "put", distancePct: 1.1, premium: 2.2, contracts: 2, dte: 3, label: "Hot print put", thesis: "Gap lower" },
          { type: "put", distancePct: 2.3, premium: 1.01, contracts: 2, dte: 3, label: "Tail hedge put", thesis: "Trend day lower" },
        ],
        scenarios: [
          { name: "Cool print relief", movePct: 2.4, probability: 27, note: "Rates ease and breadth expands." },
          { name: "Inline then drift", movePct: 0.7, probability: 24, note: "Initial move fades into a slower session." },
          { name: "Sticky inflation flush", movePct: -2.1, probability: 29, note: "Indices gap lower as rates reprice." },
          { name: "Re-acceleration scare", movePct: -3.5, probability: 20, note: "Downside trend day with vol expansion." },
        ],
      },
      {
        symbol: "QQQ",
        label: "QQQ | higher beta to rates",
        driver: "Duration and AI beta",
        seedSpot: 452,
        impliedMovePct: 1.9,
        scenarioFocus: "Higher beta than SPY when semis join the move.",
        legSeeds: [
          { type: "call", distancePct: 1.4, premium: 3.05, contracts: 2, dte: 7, label: "Relief call", thesis: "Lower yields" },
          { type: "call", distancePct: 2.8, premium: 1.38, contracts: 2, dte: 7, label: "Tail call", thesis: "AI squeeze" },
          { type: "put", distancePct: 1.3, premium: 2.9, contracts: 2, dte: 3, label: "Hot print put", thesis: "Rate shock" },
          { type: "put", distancePct: 2.6, premium: 1.25, contracts: 2, dte: 3, label: "Tail hedge put", thesis: "Momentum unwind" },
        ],
        scenarios: [
          { name: "Cool print squeeze", movePct: 3.1, probability: 27, note: "Long-duration names rip faster than SPY." },
          { name: "Mixed and choppy", movePct: 0.9, probability: 22, note: "QQQ digests the print without trend." },
          { name: "Hot print selloff", movePct: -2.8, probability: 29, note: "Growth gets hit first." },
          { name: "Rates shock trend day", movePct: -4.2, probability: 22, note: "Semis unwind together." },
        ],
      },
      {
        symbol: "SMH",
        label: "SMH | semi amplifier",
        driver: "Semiconductor beta on a rates pivot",
        seedSpot: 245,
        impliedMovePct: 2.6,
        scenarioFocus: "SMH is the kicker when lower yields or higher real rates hit AI leadership harder than the index.",
        legSeeds: [
          { type: "call", distancePct: 2.1, premium: 2.38, contracts: 1, dte: 7, label: "Semi call", thesis: "Rates relief" },
          { type: "call", distancePct: 4.2, premium: 1.02, contracts: 1, dte: 7, label: "Tail call", thesis: "AI squeeze" },
          { type: "put", distancePct: 1.9, premium: 2.22, contracts: 1, dte: 3, label: "Semi put", thesis: "Rates shock" },
          { type: "put", distancePct: 4.0, premium: 0.93, contracts: 1, dte: 3, label: "Tail put", thesis: "High beta downside" },
        ],
        scenarios: [
          { name: "Cool print relief", movePct: 4.2, probability: 27, note: "Semis often outrun the index when yields ease." },
          { name: "Mixed and choppy", movePct: 1.1, probability: 24, note: "Some follow-through, not a full squeeze." },
          { name: "Sticky inflation flush", movePct: -3.4, probability: 29, note: "Semis feel the rates repricing faster." },
          { name: "Rates shock trend day", movePct: -5.0, probability: 20, note: "Momentum unwind hits the higher beta leg." },
        ],
      },
    ],
  },
  {
    id: "energy-shock-board",
    title: "Energy Shock Board",
    kind: "commodity",
    scope: "Geopolitics, supply headlines, and oil-sensitive equity reactions",
    dayOffset: 2,
    timeLabel: "Overnight / unscheduled",
    summary: "The weekly bucket for war, sanctions, shipping, OPEC, and crude-specific shock risk.",
    whyItMatters: "When energy is the headline, XOM and XLE give you a cleaner causal chain than the indices.",
    marketProxy: "WTI / XOM / XLE / SPY",
    tags: ["oil", "geopolitics", "binary"],
    watchlistTickers: ["XOM", "XLE", "SPY"],
    primarySymbol: "XOM",
    scenarioPlanningNote: "Use the planner to map the tails, but do not size until WTI and the chain confirm the setup.",
    dataChecklist: ["WTI overnight range", "Front-week implied move", "Live headline board", "Current oil beta regime"],
    portfolioLegSeeds: [
      { symbol: "XOM", type: "call", distancePct: 3.2, premium: 1.05, contracts: 3, dte: 7, label: "Escalation call", thesis: "Oil spike" },
      { symbol: "XLE", type: "call", distancePct: 2.8, premium: 1.24, contracts: 3, dte: 7, label: "Sector escalation call", thesis: "Energy basket squeeze" },
      { symbol: "SPY", type: "put", distancePct: 1.1, premium: 2.05, contracts: 2, dte: 4, label: "Risk-off put", thesis: "Broad shock hedge" },
      { symbol: "XOM", type: "put", distancePct: 2.8, premium: 1.02, contracts: 2, dte: 4, label: "Peace put", thesis: "Oil dump" },
      { symbol: "XLE", type: "put", distancePct: 2.4, premium: 1.16, contracts: 2, dte: 4, label: "Sector relief put", thesis: "Energy unwind" },
      { symbol: "QQQ", type: "call", distancePct: 1.4, premium: 3.05, contracts: 1, dte: 7, label: "Relief call", thesis: "Risk-on unwind" },
      { symbol: "SPY", type: "call", distancePct: 1.1, premium: 2.15, contracts: 1, dte: 7, label: "Broad relief call", thesis: "Ceasefire squeeze" },
    ],
    portfolioScenarios: [
      { name: "Peace / supply relief", probability: 24, note: "War premium comes out of oil and broad risk assets squeeze higher.", moves: { XOM: -6.4, XLE: -5.2, SPY: 1.4, QQQ: 1.9 } },
      { name: "Deadline extension / chop", probability: 25, note: "Neither tail resolves and theta becomes the tax.", moves: { XOM: -1.1, XLE: -0.8, SPY: -0.3, QQQ: -0.4 } },
      { name: "Moderate escalation", probability: 31, note: "Oil squeezes, energy catches a bid, and the index hedge starts to pay.", moves: { XOM: 4.9, XLE: 4.3, SPY: -1.6, QQQ: -2.1 } },
      { name: "Infrastructure shock", probability: 20, note: "The tail outcome where energy calls and risk-off index puts both light up.", moves: { XOM: 8.3, XLE: 6.9, SPY: -2.7, QQQ: -3.4 } },
    ],
    ranking: { marketImpact: 92, tickerSensitivity: 94, asymmetry: 91, liquidity: 90, confidence: 68 },
    tickerProfiles: [
      {
        symbol: "XOM",
        label: "XOM | direct oil proxy",
        driver: "Crude shock beta",
        seedSpot: 122,
        impliedMovePct: 4.6,
        scenarioFocus: "Calls are the escalation leg. Puts are the peace leg.",
        legSeeds: [
          { type: "call", distancePct: 3.2, premium: 1.05, contracts: 3, dte: 7, label: "Escalation call", thesis: "Oil spike" },
          { type: "call", distancePct: 6.5, premium: 0.42, contracts: 4, dte: 7, label: "Tail call", thesis: "Supply shock" },
          { type: "put", distancePct: 2.8, premium: 1.02, contracts: 3, dte: 4, label: "Peace put", thesis: "Oil dump" },
          { type: "put", distancePct: 5.4, premium: 0.38, contracts: 4, dte: 4, label: "Tail put", thesis: "Fast unwind" },
        ],
        scenarios: [
          { name: "Peace / supply relief", movePct: -6.4, probability: 24, note: "War premium comes out quickly." },
          { name: "Status quo drift", movePct: -1.1, probability: 25, note: "Neither tail resolves and theta hurts." },
          { name: "Moderate escalation", movePct: 4.9, probability: 31, note: "Oil squeezes and XOM catches up." },
          { name: "Infrastructure shock", movePct: 8.3, probability: 20, note: "Tail call ladder does the work." },
        ],
      },
      {
        symbol: "XLE",
        label: "XLE | cleaner sector basket",
        driver: "Energy ETF beta",
        seedSpot: 96,
        impliedMovePct: 3.9,
        scenarioFocus: "Lower single-name noise than XOM, still strong oil beta.",
        legSeeds: [
          { type: "call", distancePct: 2.8, premium: 1.24, contracts: 3, dte: 7, label: "Escalation call", thesis: "Sector squeeze" },
          { type: "call", distancePct: 5.8, premium: 0.51, contracts: 3, dte: 7, label: "Tail call", thesis: "Oil shock" },
          { type: "put", distancePct: 2.4, premium: 1.16, contracts: 3, dte: 4, label: "Relief put", thesis: "Oil unwind" },
          { type: "put", distancePct: 4.8, premium: 0.47, contracts: 3, dte: 4, label: "Tail put", thesis: "De-escalation" },
        ],
        scenarios: [
          { name: "Supply relief", movePct: -5.2, probability: 24, note: "Energy ETF bleeds out the premium." },
          { name: "No resolution", movePct: -0.8, probability: 27, note: "Theta grind unless headlines return." },
          { name: "Moderate escalation", movePct: 4.3, probability: 30, note: "Sector catches a cleaner move." },
          { name: "Crude shock", movePct: 6.9, probability: 19, note: "ETF laggards catch up into the close." },
        ],
      },
      {
        symbol: "SPY",
        label: "SPY | relief and hedge leg",
        driver: "Broad market risk-on / risk-off",
        seedSpot: 525,
        impliedMovePct: 1.2,
        scenarioFocus: "SPY improves the opposite tail and keeps the book from being only an energy expression.",
        legSeeds: [
          { type: "call", distancePct: 1.1, premium: 2.15, contracts: 1, dte: 7, label: "Relief call", thesis: "Ceasefire squeeze" },
          { type: "call", distancePct: 2.2, premium: 0.96, contracts: 1, dte: 7, label: "Tail call", thesis: "Broader risk-on" },
          { type: "put", distancePct: 1.0, premium: 2.05, contracts: 2, dte: 4, label: "Risk-off put", thesis: "Shock hedge" },
          { type: "put", distancePct: 2.1, premium: 0.9, contracts: 1, dte: 4, label: "Tail put", thesis: "Trend lower" },
        ],
        scenarios: [
          { name: "Relief rally", movePct: 1.4, probability: 24, note: "War premium comes out and SPY lifts." },
          { name: "Wait and see", movePct: -0.3, probability: 25, note: "The tape stalls and chops." },
          { name: "Escalation risk-off", movePct: -1.6, probability: 31, note: "The hedge leg starts doing real work." },
          { name: "Full risk-off gap", movePct: -2.7, probability: 20, note: "Tail puts join the energy calls." },
        ],
      },
      {
        symbol: "QQQ",
        label: "QQQ | higher beta relief kicker",
        driver: "Growth beta on de-escalation",
        seedSpot: 452,
        impliedMovePct: 1.7,
        scenarioFocus: "QQQ is less direct than energy, but it gives the peace scenario a more explosive second engine.",
        legSeeds: [
          { type: "call", distancePct: 1.4, premium: 3.05, contracts: 1, dte: 7, label: "Relief call", thesis: "Risk-on unwind" },
          { type: "call", distancePct: 2.8, premium: 1.38, contracts: 1, dte: 7, label: "Tail call", thesis: "High-beta squeeze" },
          { type: "put", distancePct: 1.3, premium: 2.9, contracts: 1, dte: 4, label: "Risk-off put", thesis: "Shock hedge" },
          { type: "put", distancePct: 2.6, premium: 1.25, contracts: 1, dte: 4, label: "Tail put", thesis: "Growth unwind" },
        ],
        scenarios: [
          { name: "Relief rally", movePct: 1.9, probability: 24, note: "Higher beta de-escalation bounce." },
          { name: "Wait and see", movePct: -0.4, probability: 25, note: "The tape goes nowhere helpful." },
          { name: "Escalation risk-off", movePct: -2.1, probability: 31, note: "QQQ underperforms SPY on risk-off." },
          { name: "Full risk-off gap", movePct: -3.4, probability: 20, note: "Tail downside is sharper in tech, but still bounded versus a full macro crash." },
        ],
      },
    ],
  },
  {
    id: "ai-read-through",
    title: "AI Leader Read-Through",
    kind: "earnings",
    scope: "Mega-cap AI earnings and sympathy rotation into laggards",
    dayOffset: 2,
    timeLabel: "After close",
    summary: "A sector leader can reset the whole semi complex, often with laggards reacting 30 to 90 minutes late.",
    whyItMatters: "The cleanest short-dated trade often shows up in the sympathy names, not in the leader where IV is already marked up.",
    marketProxy: "AMD / SMH / QQQ",
    tags: ["semis", "earnings", "sympathy", "laggard"],
    watchlistTickers: ["AMD", "NVDA", "SMH", "QQQ"],
    primarySymbol: "AMD",
    scenarioPlanningNote: "The setup becomes better after the leader has spoken and the laggard spread is still open.",
    dataChecklist: ["Leader implied versus realized move", "ETF/component divergence", "Opening range breakout", "Spread quality"],
    portfolioLegSeeds: [
      { symbol: "AMD", type: "call", distancePct: 3.0, premium: 2.15, contracts: 2, dte: 7, label: "Sympathy call", thesis: "Bullish read-through" },
      { symbol: "SMH", type: "call", distancePct: 2.1, premium: 2.38, contracts: 2, dte: 7, label: "Sector call", thesis: "Cleaner basket follow-through" },
      { symbol: "QQQ", type: "call", distancePct: 1.3, premium: 2.92, contracts: 1, dte: 7, label: "Index kicker call", thesis: "Large-cap tech squeeze" },
      { symbol: "AMD", type: "put", distancePct: 2.6, premium: 2.05, contracts: 1, dte: 4, label: "Miss put", thesis: "Weak guide hedge" },
      { symbol: "SMH", type: "put", distancePct: 2.0, premium: 2.22, contracts: 1, dte: 4, label: "Sector put", thesis: "ETF hedge" },
      { symbol: "QQQ", type: "put", distancePct: 1.2, premium: 2.75, contracts: 1, dte: 4, label: "Growth put", thesis: "Broader unwind" },
    ],
    portfolioScenarios: [
      { name: "Leader beats, laggards catch up", probability: 28, note: "The upside engines stack: AMD catches up, SMH trends, and QQQ joins.", moves: { AMD: 7.2, SMH: 4.5, QQQ: 2.8 } },
      { name: "Good but partially priced", probability: 26, note: "Still bullish, but less explosive than the clean sympathy case.", moves: { AMD: 2.1, SMH: 1.7, QQQ: 1.0 } },
      { name: "Mixed guide / chop", probability: 21, note: "This is the tax scenario where both sides can bleed without a clean read-through.", moves: { AMD: -1.4, SMH: -1.0, QQQ: -0.7 } },
      { name: "Guide disappointment", probability: 25, note: "The hedge side finally matters and the whole AI pocket de-rates.", moves: { AMD: -8.1, SMH: -5.0, QQQ: -3.0 } },
    ],
    ranking: { marketImpact: 86, tickerSensitivity: 93, asymmetry: 89, liquidity: 94, confidence: 79 },
    tickerProfiles: [
      {
        symbol: "AMD",
        label: "AMD | laggard catch-up vehicle",
        driver: "Semiconductor sympathy",
        seedSpot: 168,
        impliedMovePct: 5.3,
        scenarioFocus: "Best used after the leader has already revealed direction.",
        legSeeds: [
          { type: "call", distancePct: 3.0, premium: 2.15, contracts: 2, dte: 7, label: "Sympathy call", thesis: "Bullish read-through" },
          { type: "call", distancePct: 6.2, premium: 0.88, contracts: 2, dte: 7, label: "Tail call", thesis: "Momentum chase" },
          { type: "put", distancePct: 2.6, premium: 2.05, contracts: 2, dte: 4, label: "Miss put", thesis: "Weak guide" },
          { type: "put", distancePct: 5.5, premium: 0.82, contracts: 2, dte: 4, label: "Tail put", thesis: "Sector unwind" },
        ],
        scenarios: [
          { name: "Leader beats, laggard catches up", movePct: 7.2, probability: 28, note: "Calls capture the sympathy rotation." },
          { name: "Leader good but already priced", movePct: 2.1, probability: 26, note: "Move is positive but less explosive." },
          { name: "Mixed guide / chop", movePct: -1.4, probability: 21, note: "Theta hurts if there is no clean message." },
          { name: "Guide disappointment", movePct: -8.1, probability: 25, note: "Puts win when the group de-rates." },
        ],
      },
      {
        symbol: "SMH",
        label: "SMH | cleaner sector basket",
        driver: "Semiconductor ETF breadth",
        seedSpot: 245,
        impliedMovePct: 3.1,
        scenarioFocus: "Lower single-name chaos than AMD, still enough beta to capture the theme.",
        legSeeds: [
          { type: "call", distancePct: 2.1, premium: 2.38, contracts: 2, dte: 7, label: "Sector call", thesis: "Bullish read-through" },
          { type: "call", distancePct: 4.2, premium: 1.02, contracts: 2, dte: 7, label: "Tail call", thesis: "Breadth expansion" },
          { type: "put", distancePct: 2.0, premium: 2.22, contracts: 2, dte: 4, label: "Sector put", thesis: "Weak guide" },
          { type: "put", distancePct: 4.0, premium: 0.93, contracts: 2, dte: 4, label: "Tail put", thesis: "Risk-off unwind" },
        ],
        scenarios: [
          { name: "Sector strength", movePct: 4.5, probability: 29, note: "ETF gives cleaner trend exposure." },
          { name: "Contained follow-through", movePct: 1.7, probability: 24, note: "Positive but less explosive than AMD." },
          { name: "No clean message", movePct: -1.0, probability: 22, note: "ETF churns while single names mean-revert." },
          { name: "Semis de-rate", movePct: -5.0, probability: 25, note: "Downside put ladder does the work." },
        ],
      },
      {
        symbol: "QQQ",
        label: "QQQ | broad beta spillover",
        driver: "Large-cap tech beta",
        seedSpot: 452,
        impliedMovePct: 1.6,
        scenarioFocus: "QQQ is the smoother third leg when you want the upside scenario to have a broader escape valve.",
        legSeeds: [
          { type: "call", distancePct: 1.3, premium: 2.92, contracts: 1, dte: 7, label: "Tech call", thesis: "Broad AI bid" },
          { type: "call", distancePct: 2.7, premium: 1.3, contracts: 1, dte: 7, label: "Tail call", thesis: "Index squeeze" },
          { type: "put", distancePct: 1.2, premium: 2.75, contracts: 1, dte: 4, label: "Tech put", thesis: "Weak mega-cap read" },
          { type: "put", distancePct: 2.5, premium: 1.18, contracts: 1, dte: 4, label: "Tail put", thesis: "Growth unwind" },
        ],
        scenarios: [
          { name: "Broad AI bid", movePct: 2.8, probability: 28, note: "QQQ joins the semis higher." },
          { name: "Positive but contained", movePct: 1.0, probability: 26, note: "The broad index confirms but does not lead." },
          { name: "Muted read-through", movePct: -0.7, probability: 21, note: "Less directional edge in the index." },
          { name: "Growth selloff", movePct: -3.0, probability: 25, note: "QQQ puts become the cleaner macro hedge." },
        ],
      },
    ],
  },
];

export function buildWeeklyScanSnapshot(now = new Date()): WeeklyScanSnapshot {
  const weekStart = getScanWeekStart(now);
  const weekEnd = addDays(weekStart, 4);
  const events = EVENT_TEMPLATES.map((template) => {
    const eventDate = addDays(weekStart, template.dayOffset);
    return {
      ...template,
      eventDate: isoDate(eventDate),
      eventLabel: formatDay(eventDate),
      ranking: {
        ...template.ranking,
        composite: compositeScore(template.ranking, template.watchlistTickers.length, template.kind),
      },
    };
  }).sort((left, right) => right.ranking.composite - left.ranking.composite);

  return {
    generatedAt: new Date().toISOString(),
    weekLabel: `Week Of ${formatDay(weekStart)}`,
    weekRangeLabel: `${formatDay(weekStart)} - ${formatDay(weekEnd)}`,
    notes: [
      "Seeded first iteration means the scenario weights, implied move inputs, and starter premiums are curated defaults, not live vendor data yet.",
      "Replace spot, implied move, and premiums with live numbers before trading. The current strike ladders reset off the spot you enter.",
      "The ranking is there to narrow attention on Monday, not to auto-trade the setup.",
      "Binary outcomes are not stored yet. To make the planner learn over time on Vercel, the next step is persisting outcome rows and pre-event option snapshots in a database.",
      "Legacy calculator flow stays untouched. This page is a separate planner we can later connect to cron jobs and live vendor data.",
    ],
    topThemes: ["macro", "laggard", "oil", "semis"],
    watchlist: WATCHLIST,
    events,
  };
}

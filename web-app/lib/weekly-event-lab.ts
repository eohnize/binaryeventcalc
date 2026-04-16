export type EventKind = "macro" | "commodity" | "earnings";

export type PredictionMarketSource = "kalshi" | "polymarket";

export type ProbabilityOverlayMode = "hybrid" | "historical-only";

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

export type PredictionMarketSignal = {
  source: PredictionMarketSource;
  marketLabel: string;
  contractLabel: string;
  probability: number;
  change1d: number;
  quality: "high" | "medium" | "low";
  note: string;
};

export type ScenarioProbabilityWeight = {
  scenarioName: string;
  historicalPrior: number;
  marketImplied: number | null;
  blendedProbability: number;
  note: string;
};

export type ProbabilityOverlay = {
  mode: ProbabilityOverlayMode;
  label: string;
  note: string;
  blendRule: string;
  marketInfluence: number;
  sources: PredictionMarketSignal[];
  scenarioWeights: ScenarioProbabilityWeight[];
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
  catalystName?: string;
  dataOrigin?: "seeded" | "live";
  dataOriginNote?: string;
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
  probabilityOverlay: ProbabilityOverlay;
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
  weekStartDate: string;
  dataSources: {
    calendars: "seeded" | "live";
    historical: "seeded" | "live";
    predictionMarkets: "seeded" | "live";
    liveEventIds: string[];
  };
  notes: string[];
  topThemes: string[];
  watchlist: WatchlistGroup[];
  events: EventCandidate[];
};

export type EvaluatedScenario = {
  scenario: PortfolioScenario;
  totalPnl: number;
  roi: number;
  symbolMoves: Array<{
    symbol: string;
    movePct: number;
    spot: number;
    spotAtEvent: number;
    impliedMovePct: number;
  }>;
};

type EventTemplate = Omit<EventCandidate, "eventDate" | "eventLabel" | "ranking" | "probabilityOverlay"> & {
  dayOffset: number;
  ranking: Omit<ScoreBreakdown, "composite">;
  probabilityOverlay: ProbabilityOverlaySeed;
};

type ScenarioProbabilitySeed = Omit<ScenarioProbabilityWeight, "blendedProbability">;

type ProbabilityOverlaySeed = Omit<ProbabilityOverlay, "blendRule" | "scenarioWeights"> & {
  scenarioWeights: ScenarioProbabilitySeed[];
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

function normalizeProbabilities(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);

  const scaled = values.map((value) => (value / total) * 100);
  const floors = scaled.map((value) => Math.floor(value));
  let remainder = 100 - floors.reduce((sum, value) => sum + value, 0);
  const rankedFractions = scaled
    .map((value, index) => ({ index, fraction: value - floors[index] }))
    .sort((left, right) => right.fraction - left.fraction);

  const normalized = [...floors];
  let pointer = 0;
  while (remainder > 0 && rankedFractions.length > 0) {
    normalized[rankedFractions[pointer % rankedFractions.length].index] += 1;
    remainder -= 1;
    pointer += 1;
  }

  return normalized;
}

function buildProbabilityOverlay(seed: ProbabilityOverlaySeed): ProbabilityOverlay {
  const rawBlended = seed.scenarioWeights.map((scenario) =>
    scenario.marketImplied == null
      ? scenario.historicalPrior
      : scenario.historicalPrior * (1 - seed.marketInfluence) + scenario.marketImplied * seed.marketInfluence,
  );
  const blended = normalizeProbabilities(rawBlended);
  const blendRule =
    seed.mode === "historical-only"
      ? "Historical prior only. No direct prediction-market contract is blended into this board yet."
      : `Blended ${Math.round((1 - seed.marketInfluence) * 100)}% historical prior with ${Math.round(seed.marketInfluence * 100)}% live market-odds bias.`;

  return {
    ...seed,
    blendRule,
    scenarioWeights: seed.scenarioWeights.map((scenario, index) => ({
      ...scenario,
      blendedProbability: blended[index],
    })),
  };
}

function applyBlendedProbabilities(scenarios: PortfolioScenario[], overlay: ProbabilityOverlay) {
  const probabilityByName = new Map(
    overlay.scenarioWeights.map((weight) => [weight.scenarioName, weight.blendedProbability]),
  );

  return scenarios.map((scenario) => ({
    ...scenario,
    probability: probabilityByName.get(scenario.name) ?? scenario.probability,
  }));
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

export function evaluatePortfolioScenarios(
  event: EventCandidate,
  legs: PlannerLeg[] = buildPortfolioStarterLegs(event),
  spotBySymbol?: Record<string, number>,
  impliedMoveBySymbol?: Record<string, number>,
): EvaluatedScenario[] {
  const resolvedSpotBySymbol = Object.fromEntries(
    event.tickerProfiles.map((profile) => [profile.symbol, spotBySymbol?.[profile.symbol] ?? profile.seedSpot]),
  );
  const resolvedImpliedMoveBySymbol = Object.fromEntries(
    event.tickerProfiles.map((profile) => [
      profile.symbol,
      impliedMoveBySymbol?.[profile.symbol] ?? profile.impliedMovePct,
    ]),
  );
  const totalInvested = legs.reduce((sum, leg) => sum + leg.premium * leg.contracts * 100, 0);

  return event.portfolioScenarios.map((scenario) => {
    const symbolMoves = event.tickerProfiles.map((profile) => {
      const spot = resolvedSpotBySymbol[profile.symbol] ?? profile.seedSpot;
      const movePct = scenario.moves[profile.symbol] ?? 0;
      return {
        symbol: profile.symbol,
        movePct,
        spot,
        spotAtEvent: spot * (1 + movePct / 100),
        impliedMovePct: resolvedImpliedMoveBySymbol[profile.symbol] ?? profile.impliedMovePct,
      };
    });
    const moveBySymbol = Object.fromEntries(symbolMoves.map((move) => [move.symbol, move]));
    const totalPnl = legs.reduce((sum, leg) => {
      const currentSpot = moveBySymbol[leg.symbol]?.spot ?? 100;
      const spotAtEvent = moveBySymbol[leg.symbol]?.spotAtEvent ?? currentSpot;
      const exit = estimateOptionPrice(leg.type, leg.strike, leg.premium, leg.dte, spotAtEvent, currentSpot);
      const cost = leg.premium * leg.contracts * 100;
      const value = exit * leg.contracts * 100;
      return sum + (value - cost);
    }, 0);

    return {
      scenario,
      totalPnl,
      roi: totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0,
      symbolMoves,
    };
  });
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
    probabilityOverlay: {
      mode: "hybrid",
      label: "Macro odds overlay",
      note: "Prediction markets do not replace the print, but they help us see whether the crowd is leaning toward a cooler or hotter surprise before the release.",
      marketInfluence: 0.45,
      sources: [
        {
          source: "kalshi",
          marketLabel: "CPI surprise board",
          contractLabel: "Cooler-than-consensus print",
          probability: 42,
          change1d: 5,
          quality: "high",
          note: "Most direct event contract in the stack.",
        },
        {
          source: "polymarket",
          marketLabel: "Rates narrative proxy",
          contractLabel: "More dovish path by late summer",
          probability: 47,
          change1d: 3,
          quality: "medium",
          note: "Useful as a bias check, but less direct than the CPI contract itself.",
        },
      ],
      scenarioWeights: [
        { scenarioName: "Cool print relief", historicalPrior: 27, marketImplied: 24, note: "The market still leans slightly warmer than a clean relief print." },
        { scenarioName: "Inline / churn", historicalPrior: 24, marketImplied: 31, note: "Inline remains the crowd's nuisance base case." },
        { scenarioName: "Sticky inflation flush", historicalPrior: 29, marketImplied: 27, note: "Still very live, but not running away from the field." },
        { scenarioName: "Rates shock trend day", historicalPrior: 20, marketImplied: 18, note: "The true downside tail stays capped until the print proves otherwise." },
      ],
    },
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
    probabilityOverlay: {
      mode: "hybrid",
      label: "Geopolitical odds overlay",
      note: "Prediction markets are strongest here as a bias gauge for de-escalation versus delay, while the move map still comes from transmission history across oil, energy equities, and indices.",
      marketInfluence: 0.55,
      sources: [
        {
          source: "kalshi",
          marketLabel: "Gulf resolution board",
          contractLabel: "Ceasefire or supply reopening by week end",
          probability: 38,
          change1d: -4,
          quality: "high",
          note: "Cleaner structured event contract for the weekly board.",
        },
        {
          source: "polymarket",
          marketLabel: "Conflict de-escalation",
          contractLabel: "Tensions ease this week",
          probability: 41,
          change1d: -6,
          quality: "medium",
          note: "Broad sentiment signal, but quality depends on market depth and spread.",
        },
      ],
      scenarioWeights: [
        { scenarioName: "Peace / supply relief", historicalPrior: 24, marketImplied: 21, note: "Relief is still possible, but the live market does not trust the clean resolution yet." },
        { scenarioName: "Deadline extension / chop", historicalPrior: 25, marketImplied: 29, note: "The crowd often underestimates how often ambiguity wins for a while." },
        { scenarioName: "Moderate escalation", historicalPrior: 31, marketImplied: 30, note: "Still the central risk path if de-escalation does not arrive." },
        { scenarioName: "Infrastructure shock", historicalPrior: 20, marketImplied: 20, note: "The true tail remains capped, but too dangerous to ignore." },
      ],
    },
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
    probabilityOverlay: {
      mode: "historical-only",
      label: "Historical prior only",
      note: "There usually is no clean direct prediction-market contract for single-name sympathy earnings setups, so the board leans on historical priors until we have enough of our own logged cases.",
      marketInfluence: 0,
      sources: [],
      scenarioWeights: [
        { scenarioName: "Leader beats, laggards catch up", historicalPrior: 28, marketImplied: null, note: "Best upside read-through case." },
        { scenarioName: "Good but partially priced", historicalPrior: 26, marketImplied: null, note: "Positive, but already crowded." },
        { scenarioName: "Mixed guide / chop", historicalPrior: 21, marketImplied: null, note: "Theta tax scenario." },
        { scenarioName: "Guide disappointment", historicalPrior: 25, marketImplied: null, note: "Downside de-rating case." },
      ],
    },
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
  const defaultSeedReason = (eventId: string) => {
    if (eventId === "inflation-reset") {
      return "Seeded fallback until a live CPI or PPI event is matched for the week.";
    }
    if (eventId === "ai-read-through") {
      return "Seeded fallback until a qualifying earnings event above the size and liquidity threshold is matched for the week.";
    }
    if (eventId === "energy-shock-board") {
      return "Seeded for now because the oil and geopolitical board still needs a live event feed.";
    }
    return "Seeded fallback while live event sourcing is still unavailable for this setup.";
  };
  const events = EVENT_TEMPLATES.map((template) => {
    const eventDate = addDays(weekStart, template.dayOffset);
    const probabilityOverlay = buildProbabilityOverlay(template.probabilityOverlay);
    return {
      ...template,
      dataOrigin: "seeded" as const,
      dataOriginNote: defaultSeedReason(template.id),
      eventDate: isoDate(eventDate),
      eventLabel: formatDay(eventDate),
      probabilityOverlay,
      portfolioScenarios: applyBlendedProbabilities(template.portfolioScenarios, probabilityOverlay),
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
    weekStartDate: isoDate(weekStart),
    dataSources: {
      calendars: "seeded",
      historical: "seeded",
      predictionMarkets: "seeded",
      liveEventIds: [],
    },
    notes: [
      "Seeded first iteration means the scenario weights, implied move inputs, and starter premiums are curated defaults, not live vendor data yet.",
      "Prediction-market inputs are now blended into the weekly scan when a clean contract exists, but they are still seeded placeholders until we connect real APIs.",
      "Replace spot, implied move, and premiums with live numbers before trading. The current strike ladders reset off the spot you enter.",
      "The ranking is there to narrow attention on Monday, not to auto-trade the setup.",
      "Weekly scan saves and realized outcomes now persist in Postgres so the planner can be reviewed against what actually resolved.",
      "Legacy calculator flow stays untouched. This page is a separate planner that can keep evolving without breaking the desktop calculator.",
    ],
    topThemes: ["macro", "laggard", "oil", "semis"],
    watchlist: WATCHLIST,
    events,
  };
}

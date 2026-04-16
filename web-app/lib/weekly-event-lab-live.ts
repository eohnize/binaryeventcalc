import {
  buildWeeklyScanSnapshot,
  type EventCandidate,
  type PortfolioLegSeed,
  type PortfolioScenario,
  type PredictionMarketSignal,
  type ProbabilityOverlay,
  type ScenarioProbabilityWeight,
  type ScoreBreakdown,
  type TickerProfile,
  type WeeklyScanSnapshot,
} from "./weekly-event-lab";

type FmpEconomicCalendarEntry = {
  date?: string | null;
  country?: string | null;
  event?: string | null;
  actual?: string | number | null;
  consensus?: string | number | null;
  previous?: string | number | null;
};

type FmpEarningsCalendarEntry = {
  date?: string | null;
  symbol?: string | null;
  eps?: string | number | null;
  epsEstimated?: string | number | null;
  time?: string | null;
};

type FmpProfileEntry = {
  symbol?: string | null;
  companyName?: string | null;
  mktCap?: string | number | null;
  marketCap?: string | number | null;
  volAvg?: string | number | null;
  avgVolume?: string | number | null;
  price?: string | number | null;
  sector?: string | null;
  industry?: string | null;
};

type MacroConfig = {
  key: "cpi" | "ppi";
  matcher: RegExp;
  catalystName: string;
  positiveScenario: string;
  neutralScenario: string;
  negativeScenario: string;
  tailScenario: string;
  priority: number;
};

type EarningsPlaybook = {
  etfSymbol: string;
  indexSymbol: string;
  tags: string[];
  scope: string;
  whyItMatters: string;
  marketProxy: string;
  scenarioPlanningNote: string;
  dataChecklist: string[];
  primaryImpliedMove: number;
  etfImpliedMove: number;
  indexImpliedMove: number;
  mainLegLabel: string;
  scenarioMoves: {
    beat: Record<string, number>;
    good: Record<string, number>;
    flat: Record<string, number>;
    miss: Record<string, number>;
  };
};

const FMP_BASE_URL = process.env.FMP_BASE_URL?.trim() || "https://financialmodelingprep.com/stable";

const MACRO_CONFIGS: MacroConfig[] = [
  {
    key: "cpi",
    matcher: /consumer price index/i,
    catalystName: "CPI",
    positiveScenario: "Cool print relief",
    neutralScenario: "Inline / churn",
    negativeScenario: "Sticky inflation flush",
    tailScenario: "Rates shock trend day",
    priority: 110,
  },
  {
    key: "ppi",
    matcher: /producer price index/i,
    catalystName: "PPI",
    positiveScenario: "Cool print relief",
    neutralScenario: "Inline / churn",
    negativeScenario: "Sticky inflation flush",
    tailScenario: "Rates shock trend day",
    priority: 100,
  },
];

const TECH_PLAYBOOK: EarningsPlaybook = {
  etfSymbol: "QQQ",
  indexSymbol: "SPY",
  tags: ["earnings", "mega-cap", "read-through", "quality"],
  scope: "Mega-cap earnings with spillover into index and growth beta",
  whyItMatters:
    "The cleanest asymmetric expression is often the incumbent plus liquid index proxies, not a single isolated contract.",
  marketProxy: "PRIMARY / QQQ / SPY",
  scenarioPlanningNote:
    "Use the incumbent for the direct read, then let QQQ or SPY carry the broader sympathy leg if the result is clean.",
  dataChecklist: [
    "EPS versus estimate",
    "Guide tone and capex commentary",
    "Front-week implied move",
    "First-hour spread quality",
  ],
  primaryImpliedMove: 5.8,
  etfImpliedMove: 1.9,
  indexImpliedMove: 1.2,
  mainLegLabel: "Incumbent earnings leg",
  scenarioMoves: {
    beat: { PRIMARY: 5.8, QQQ: 2.1, SPY: 1.1 },
    good: { PRIMARY: 2.4, QQQ: 0.9, SPY: 0.5 },
    flat: { PRIMARY: -0.6, QQQ: -0.2, SPY: -0.1 },
    miss: { PRIMARY: -6.4, QQQ: -1.8, SPY: -1.0 },
  },
};

const SEMI_PLAYBOOK: EarningsPlaybook = {
  etfSymbol: "SMH",
  indexSymbol: "QQQ",
  tags: ["earnings", "semis", "read-through", "quality"],
  scope: "Semi leader earnings with ETF and index read-through",
  whyItMatters:
    "A clean semiconductor print can move the incumbent, the ETF basket, and QQQ in the same direction within hours.",
  marketProxy: "PRIMARY / SMH / QQQ",
  scenarioPlanningNote:
    "Use the leader for the direct view, then let SMH and QQQ absorb the broader semiconductor and AI follow-through.",
  dataChecklist: [
    "EPS versus estimate",
    "Revenue and guide delta",
    "Front-week implied move",
    "SMH relative strength after the print",
  ],
  primaryImpliedMove: 6.5,
  etfImpliedMove: 3.1,
  indexImpliedMove: 1.8,
  mainLegLabel: "Semi leader leg",
  scenarioMoves: {
    beat: { PRIMARY: 7.2, SMH: 4.3, QQQ: 2.6 },
    good: { PRIMARY: 2.8, SMH: 1.6, QQQ: 0.9 },
    flat: { PRIMARY: -1.0, SMH: -0.5, QQQ: -0.3 },
    miss: { PRIMARY: -8.0, SMH: -4.6, QQQ: -2.7 },
  },
};

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDayLabel(dateValue: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(
    new Date(`${dateValue}T00:00:00.000Z`),
  );
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

function toNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9.+-]/g, "");
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function midpoint(left: number | null, right: number | null, fallback: number | null) {
  if (left != null && right != null) return (left + right) / 2;
  if (left != null) return left;
  if (right != null) return right;
  return fallback;
}

function mapTimeLabel(raw: string | null | undefined, fallback: string) {
  const value = raw?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "bmo") return "Before open";
  if (value === "amc") return "After close";
  return raw ?? fallback;
}

function buildUrl(path: string, params: Record<string, string | number | undefined>) {
  const url = new URL(path, FMP_BASE_URL.endsWith("/") ? FMP_BASE_URL : `${FMP_BASE_URL}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url, {
    next: { revalidate: 900 },
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Request failed ${response.status} for ${url}`);
  }

  return (await response.json()) as T;
}

async function fetchFmpEconomicCalendar(from: string, to: string) {
  const apiKey = process.env.FMP_API_KEY?.trim();
  if (!apiKey) return [];
  return fetchJson<FmpEconomicCalendarEntry[]>(
    buildUrl("economic-calendar", { from, to, apikey: apiKey }),
  );
}

async function fetchFmpEarningsCalendar(from: string, to: string) {
  const apiKey = process.env.FMP_API_KEY?.trim();
  if (!apiKey) return [];
  return fetchJson<FmpEarningsCalendarEntry[]>(
    buildUrl("earnings-calendar", { from, to, apikey: apiKey }),
  );
}

async function fetchFmpProfile(symbol: string) {
  const apiKey = process.env.FMP_API_KEY?.trim();
  if (!apiKey) return null;
  const rows = await fetchJson<FmpProfileEntry[]>(
    buildUrl("profile", { symbol, apikey: apiKey }),
  );
  return rows[0] ?? null;
}

async function fetchKalshiSignal(marketTicker: string, marketLabel: string, contractLabel: string, note: string) {
  const url = `https://api.elections.kalshi.com/trade-api/v2/markets/${encodeURIComponent(marketTicker)}`;
  const payload = await fetchJson<Record<string, unknown>>(url);
  const market = (payload.market as Record<string, unknown> | undefined) ?? payload;

  const bid = toNumber(market.yes_bid_dollars as string | number | null | undefined);
  const ask = toNumber(market.yes_ask_dollars as string | number | null | undefined);
  const last =
    toNumber(market.last_price as string | number | null | undefined) ??
    toNumber(market.last_price_dollars as string | number | null | undefined);
  const probability = midpoint(bid, ask, last);

  if (probability == null) return null;

  return {
    source: "kalshi" as const,
    marketLabel,
    contractLabel,
    probability: Math.round(probability * 100),
    change1d: 0,
    quality: bid != null && ask != null ? "high" as const : "medium" as const,
    note,
  };
}

async function fetchPolymarketSignal(slug: string, marketLabel: string, note: string) {
  const url = `https://gamma-api.polymarket.com/markets/slug/${encodeURIComponent(slug)}`;
  const market = await fetchJson<Record<string, unknown>>(url);

  const bestBid = toNumber(market.bestBid as string | number | null | undefined);
  const bestAsk = toNumber(market.bestAsk as string | number | null | undefined);
  const last = toNumber(market.lastTradePrice as string | number | null | undefined);
  const probability = midpoint(bestBid, bestAsk, last);
  if (probability == null) return null;

  const dayChange = toNumber(market.oneDayPriceChange as string | number | null | undefined);

  return {
    source: "polymarket" as const,
    marketLabel,
    contractLabel: String(market.question ?? slug),
    probability: Math.round(probability * 100),
    change1d: dayChange == null ? 0 : Math.round(dayChange * 100),
    quality: bestBid != null && bestAsk != null ? "medium" as const : "low" as const,
    note,
  };
}

function buildProbabilityOverlay(
  scenarioSeeds: Array<Omit<ScenarioProbabilityWeight, "blendedProbability">>,
  sources: PredictionMarketSignal[],
  marketInfluence: number,
  mode: ProbabilityOverlay["mode"],
  label: string,
  note: string,
): ProbabilityOverlay {
  const rawBlended = scenarioSeeds.map((scenario) =>
    scenario.marketImplied == null
      ? scenario.historicalPrior
      : scenario.historicalPrior * (1 - marketInfluence) + scenario.marketImplied * marketInfluence,
  );
  const blended = normalizeProbabilities(rawBlended);

  return {
    mode,
    label,
    note,
    marketInfluence,
    sources,
    blendRule:
      mode === "historical-only"
        ? "Historical prior only. No direct prediction-market contract is blended into this board yet."
        : `Blended ${Math.round((1 - marketInfluence) * 100)}% historical prior with ${Math.round(
            marketInfluence * 100,
          )}% live market-odds bias.`,
    scenarioWeights: scenarioSeeds.map((scenario, index) => ({
      ...scenario,
      blendedProbability: blended[index],
    })),
  };
}

function applyOverlayScenarios(scenarios: PortfolioScenario[], overlay: ProbabilityOverlay): PortfolioScenario[] {
  const probabilityByName = new Map(
    overlay.scenarioWeights.map((weight) => [weight.scenarioName, weight.blendedProbability]),
  );

  return scenarios.map((scenario) => ({
    ...scenario,
    probability: probabilityByName.get(scenario.name) ?? scenario.probability,
  }));
}

function compositeScore(
  ranking: Omit<ScoreBreakdown, "composite">,
  watchlistCoverage: number,
  kind: EventCandidate["kind"],
) {
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
      18 + weightedBase * 0.68 + Math.min(watchlistCoverage * 1.2, 6) + kindBonus - uncertaintyPenalty,
    ),
  );
}

function chooseMacroEvent(entries: FmpEconomicCalendarEntry[]) {
  return entries
    .map((entry) => {
      const config = MACRO_CONFIGS.find((item) => item.matcher.test(entry.event ?? ""));
      return config ? { entry, config } : null;
    })
    .filter((entry): entry is { entry: FmpEconomicCalendarEntry; config: MacroConfig } => Boolean(entry))
    .sort((left, right) => {
      if (right.config.priority !== left.config.priority) return right.config.priority - left.config.priority;
      return String(left.entry.date ?? "").localeCompare(String(right.entry.date ?? ""));
    })[0];
}

function classifyMacroScenario(entry: FmpEconomicCalendarEntry, config: MacroConfig) {
  const actual = toNumber(entry.actual);
  const expected = toNumber(entry.consensus) ?? toNumber(entry.previous);

  if (actual == null || expected == null) return config.neutralScenario;

  const surprise = actual - expected;
  if (surprise <= -0.1) return config.positiveScenario;
  if (surprise > 0.18) return config.tailScenario;
  if (surprise >= 0.06) return config.negativeScenario;
  return config.neutralScenario;
}

function classifyEarningsScenario(entry: FmpEarningsCalendarEntry) {
  const actual = toNumber(entry.eps);
  const estimate = toNumber(entry.epsEstimated);
  if (actual == null || estimate == null || Math.abs(estimate) < 0.0001) return "Inline / flat";

  const surprisePct = ((actual - estimate) / Math.abs(estimate)) * 100;
  if (surprisePct >= 8) return "Beat and lift";
  if (surprisePct >= 0) return "Beat but contained";
  if (surprisePct > -5) return "Inline / flat";
  return "Miss and unwind";
}

function buildHistoricalPriors(scenarioNames: string[], classifications: string[]) {
  const counts = Object.fromEntries(scenarioNames.map((name) => [name, 1])) as Record<string, number>;

  for (const classification of classifications) {
    if (classification in counts) counts[classification] += 1;
  }

  const sampleSize = classifications.length;
  const normalized = normalizeProbabilities(scenarioNames.map((name) => counts[name]));

  return {
    sampleSize,
    probabilities: Object.fromEntries(
      scenarioNames.map((name, index) => [name, normalized[index]]),
    ) as Record<string, number>,
  };
}

function deriveMarketScenarioSeeds(
  scenarioNames: string[],
  historicalPrior: Record<string, number>,
  positiveScenario: string,
  neutralScenario: string,
  positiveProbability: number | null,
) {
  return scenarioNames.map((name) => {
    if (positiveProbability == null) {
      return {
        scenarioName: name,
        historicalPrior: historicalPrior[name] ?? 0,
        marketImplied: null,
        note: "Historical prior only until a clean live market is available.",
      };
    }

    const neutralBase = historicalPrior[neutralScenario] ?? 24;
    let neutralProbability = clamp(neutralBase, 16, 34);
    let remaining = 100 - positiveProbability - neutralProbability;
    if (remaining < 8) {
      neutralProbability = clamp(100 - positiveProbability - 8, 10, 34);
      remaining = 100 - positiveProbability - neutralProbability;
    }

    const residualNames = scenarioNames.filter(
      (scenarioName) => scenarioName !== positiveScenario && scenarioName !== neutralScenario,
    );
    const residualBase = residualNames.reduce((sum, scenarioName) => sum + (historicalPrior[scenarioName] ?? 1), 0);

    if (name === positiveScenario) {
      return {
        scenarioName: name,
        historicalPrior: historicalPrior[name] ?? 0,
        marketImplied: Math.round(positiveProbability),
        note: "Live prediction-market bias for the positive resolution branch.",
      };
    }

    if (name === neutralScenario) {
      return {
        scenarioName: name,
        historicalPrior: historicalPrior[name] ?? 0,
        marketImplied: Math.round(neutralProbability),
        note: "Neutral branch held near its historical nuisance rate so the live bias mainly tilts the tails.",
      };
    }

    const share = residualBase > 0 ? (historicalPrior[name] ?? 1) / residualBase : 1 / Math.max(residualNames.length, 1);
    return {
      scenarioName: name,
      historicalPrior: historicalPrior[name] ?? 0,
      marketImplied: Math.round(remaining * share),
      note: "Residual downside probability split across the adverse branches using historical shape.",
    };
  });
}

function pickEarningsPlaybook(profile: FmpProfileEntry | null) {
  const sector = `${profile?.sector ?? ""} ${profile?.industry ?? ""}`.toLowerCase();
  if (sector.includes("semiconductor")) return SEMI_PLAYBOOK;
  return TECH_PLAYBOOK;
}

function buildTickerProfilesForEarnings(
  symbol: string,
  companyName: string,
  profile: FmpProfileEntry | null,
  etfProfile: FmpProfileEntry | null,
  indexProfile: FmpProfileEntry | null,
  playbook: EarningsPlaybook,
): TickerProfile[] {
  const primarySpot = toNumber(profile?.price) ?? 100;
  const etfSpot = toNumber(etfProfile?.price) ?? (playbook.etfSymbol === "SMH" ? 245 : 452);
  const indexSpot = toNumber(indexProfile?.price) ?? (playbook.indexSymbol === "SPY" ? 525 : 452);

  return [
    {
      symbol,
      label: `${symbol} | incumbent earnings leg`,
      driver: companyName || "Mega-cap earnings",
      seedSpot: primarySpot,
      impliedMovePct: playbook.primaryImpliedMove,
      scenarioFocus: "Use the incumbent for the direct post-print move.",
      legSeeds: [
        { type: "call", distancePct: 3.0, premium: 2.4, contracts: 2, dte: 7, label: playbook.mainLegLabel, thesis: "Positive print" },
        { type: "call", distancePct: 6.0, premium: 1.05, contracts: 1, dte: 7, label: "Tail call", thesis: "Upside squeeze" },
        { type: "put", distancePct: 3.0, premium: 2.3, contracts: 2, dte: 4, label: "Miss put", thesis: "Negative guide" },
        { type: "put", distancePct: 6.0, premium: 0.98, contracts: 1, dte: 4, label: "Tail put", thesis: "De-rate tail" },
      ],
      scenarios: [
        { name: "Beat and lift", movePct: playbook.scenarioMoves.beat.PRIMARY, probability: 30, note: "Strong post-print upside." },
        { name: "Beat but contained", movePct: playbook.scenarioMoves.good.PRIMARY, probability: 25, note: "Positive, but less explosive." },
        { name: "Inline / flat", movePct: playbook.scenarioMoves.flat.PRIMARY, probability: 20, note: "Chop and theta tax." },
        { name: "Miss and unwind", movePct: playbook.scenarioMoves.miss.PRIMARY, probability: 25, note: "Downside de-rate." },
      ],
    },
    {
      symbol: playbook.etfSymbol,
      label: `${playbook.etfSymbol} | related basket`,
      driver: "Adjacent ETF confirmation leg",
      seedSpot: etfSpot,
      impliedMovePct: playbook.etfImpliedMove,
      scenarioFocus: "Lets the same thesis pay through the sector basket, not just the incumbent.",
      legSeeds: [
        { type: "call", distancePct: 2.0, premium: 2.1, contracts: 1, dte: 7, label: "ETF call", thesis: "Sector follow-through" },
        { type: "put", distancePct: 2.0, premium: 2.0, contracts: 1, dte: 4, label: "ETF put", thesis: "Sector unwind" },
      ],
      scenarios: [
        { name: "Beat and lift", movePct: playbook.scenarioMoves.beat[playbook.etfSymbol], probability: 30, note: "ETF confirms the positive read." },
        { name: "Beat but contained", movePct: playbook.scenarioMoves.good[playbook.etfSymbol], probability: 25, note: "ETF joins, but not explosively." },
        { name: "Inline / flat", movePct: playbook.scenarioMoves.flat[playbook.etfSymbol], probability: 20, note: "ETF stalls." },
        { name: "Miss and unwind", movePct: playbook.scenarioMoves.miss[playbook.etfSymbol], probability: 25, note: "ETF de-rates with the incumbent." },
      ],
    },
    {
      symbol: playbook.indexSymbol,
      label: `${playbook.indexSymbol} | index spillover`,
      driver: "Broad risk-on / risk-off spillover",
      seedSpot: indexSpot,
      impliedMovePct: playbook.indexImpliedMove,
      scenarioFocus: "Adds the broad market leg so the basket is not dependent on one chain.",
      legSeeds: [
        { type: "call", distancePct: 1.2, premium: 2.0, contracts: 1, dte: 7, label: "Index call", thesis: "Broad relief" },
        { type: "put", distancePct: 1.2, premium: 1.95, contracts: 1, dte: 4, label: "Index put", thesis: "Risk-off hedge" },
      ],
      scenarios: [
        { name: "Beat and lift", movePct: playbook.scenarioMoves.beat[playbook.indexSymbol], probability: 30, note: "Index confirms the upside." },
        { name: "Beat but contained", movePct: playbook.scenarioMoves.good[playbook.indexSymbol], probability: 25, note: "Modest index confirmation." },
        { name: "Inline / flat", movePct: playbook.scenarioMoves.flat[playbook.indexSymbol], probability: 20, note: "Broad tape is muted." },
        { name: "Miss and unwind", movePct: playbook.scenarioMoves.miss[playbook.indexSymbol], probability: 25, note: "Index hedge starts to matter." },
      ],
    },
  ];
}

function buildPortfolioLegSeeds(symbol: string, playbook: EarningsPlaybook): PortfolioLegSeed[] {
  return [
    { symbol, type: "call", distancePct: 3.0, premium: 2.4, contracts: 2, dte: 7, label: "Incumbent call", thesis: "Clean beat" },
    { symbol: playbook.etfSymbol, type: "call", distancePct: 2.0, premium: 2.1, contracts: 1, dte: 7, label: "ETF call", thesis: "Read-through basket" },
    { symbol: playbook.indexSymbol, type: "call", distancePct: 1.2, premium: 2.0, contracts: 1, dte: 7, label: "Index call", thesis: "Broad lift" },
    { symbol, type: "put", distancePct: 3.0, premium: 2.3, contracts: 2, dte: 4, label: "Incumbent put", thesis: "Miss hedge" },
    { symbol: playbook.etfSymbol, type: "put", distancePct: 2.0, premium: 2.0, contracts: 1, dte: 4, label: "ETF put", thesis: "Sector hedge" },
    { symbol: playbook.indexSymbol, type: "put", distancePct: 1.2, premium: 1.95, contracts: 1, dte: 4, label: "Index put", thesis: "Broader unwind" },
  ];
}

function buildEarningsScenarios(playbook: EarningsPlaybook): PortfolioScenario[] {
  return [
    { name: "Beat and lift", probability: 30, note: "The print clears and the positive read carries.", moves: { ...playbook.scenarioMoves.beat } },
    { name: "Beat but contained", probability: 25, note: "Positive, but not enough to start a squeeze.", moves: { ...playbook.scenarioMoves.good } },
    { name: "Inline / flat", probability: 20, note: "The setup fails to stretch either way.", moves: { ...playbook.scenarioMoves.flat } },
    { name: "Miss and unwind", probability: 25, note: "The downside hedge becomes the useful leg.", moves: { ...playbook.scenarioMoves.miss } },
  ];
}

function computeLiquidityScore(avgVolume: number) {
  if (avgVolume >= 20_000_000) return 98;
  if (avgVolume >= 10_000_000) return 95;
  if (avgVolume >= 5_000_000) return 92;
  return 88;
}

function isUnitedStatesEvent(country: string | null | undefined) {
  const normalized = (country ?? "US").trim().toLowerCase();
  return normalized === "us" || normalized === "usa" || normalized.includes("united states");
}

async function buildLiveMacroEvent(baseEvent: EventCandidate, weekStartDate: string) {
  const weekStart = new Date(`${weekStartDate}T00:00:00.000Z`);
  const weekEnd = addDays(weekStart, 4);
  const currentWeek = await fetchFmpEconomicCalendar(isoDate(weekStart), isoDate(weekEnd));
  const selected = chooseMacroEvent(currentWeek.filter((entry) => isUnitedStatesEvent(entry.country)));
  if (!selected) return null;

  const historicalWindowStart = addDays(weekStart, -730);
  const historical = await fetchFmpEconomicCalendar(isoDate(historicalWindowStart), isoDate(addDays(weekStart, -1)));
  const historicalMatches = historical.filter(
    (entry) => isUnitedStatesEvent(entry.country) && selected.config.matcher.test(entry.event ?? ""),
  );
  const scenarioNames = baseEvent.portfolioScenarios.map((scenario) => scenario.name);
  const historicalPrior = buildHistoricalPriors(
    scenarioNames,
    historicalMatches.map((entry) => classifyMacroScenario(entry, selected.config)),
  );

  const kalshiTickerEnv = process.env[`KALSHI_${selected.config.key.toUpperCase()}_MARKET_TICKER`]?.trim();
  const polymarketSlugEnv = process.env[`POLYMARKET_${selected.config.key.toUpperCase()}_MARKET_SLUG`]?.trim();

  const sources: PredictionMarketSignal[] = [];
  if (kalshiTickerEnv) {
    try {
      const signal = await fetchKalshiSignal(
        kalshiTickerEnv,
        `${selected.config.catalystName} surprise board`,
        `Cooling outcome for ${selected.config.catalystName}`,
        "Live Kalshi market for the positive surprise branch.",
      );
      if (signal) sources.push(signal);
    } catch (error) {
      console.error("weekly-event-lab-live: failed to fetch Kalshi macro signal", error);
    }
  }

  if (polymarketSlugEnv) {
    try {
      const signal = await fetchPolymarketSignal(
        polymarketSlugEnv,
        `${selected.config.catalystName} market bias`,
        "Live Polymarket midpoint used as a secondary bias check.",
      );
      if (signal) sources.push(signal);
    } catch (error) {
      console.error("weekly-event-lab-live: failed to fetch Polymarket macro signal", error);
    }
  }

  const livePositiveProbability =
    sources.length > 0
      ? Math.round(sources.reduce((sum, source) => sum + source.probability, 0) / sources.length)
      : null;

  const overlay = buildProbabilityOverlay(
    deriveMarketScenarioSeeds(
      scenarioNames,
      historicalPrior.probabilities,
      selected.config.positiveScenario,
      selected.config.neutralScenario,
      livePositiveProbability,
    ),
    sources,
    sources.length > 0 ? 0.45 : 0,
    sources.length > 0 ? "hybrid" : "historical-only",
    `${selected.config.catalystName} odds overlay`,
    sources.length > 0
      ? `Historical prior from ${historicalPrior.sampleSize} prior ${selected.config.catalystName} releases, tilted by live prediction-market bias.`
      : `Historical prior from ${historicalPrior.sampleSize} prior ${selected.config.catalystName} releases. No clean live contract configured yet.`,
  );

  const rankingBase: Omit<ScoreBreakdown, "composite"> = {
    ...baseEvent.ranking,
    confidence: clamp(60 + Math.min(historicalPrior.sampleSize * 2, 22) + (sources.length > 0 ? 8 : 0), 60, 94),
  };

  return {
    ...baseEvent,
    catalystName: selected.config.catalystName,
    eventDate: selected.entry.date?.slice(0, 10) ?? baseEvent.eventDate,
    eventLabel: selected.entry.date?.slice(0, 10)
      ? formatDayLabel(selected.entry.date.slice(0, 10))
      : baseEvent.eventLabel,
    title: baseEvent.title,
    timeLabel: "08:30 ET",
    summary: `${selected.config.catalystName} can reset rates, index breadth, and short-dated implieds in the first hour.`,
    whyItMatters: `${selected.config.catalystName} is the cleanest macro catalyst in the current week, and the board now uses real release history instead of static priors.`,
    scenarioPlanningNote: `Historical priors are seeded from ${historicalPrior.sampleSize} prior ${selected.config.catalystName} releases. Replace starter premiums with the live chain before sizing.`,
    probabilityOverlay: overlay,
    portfolioScenarios: applyOverlayScenarios(baseEvent.portfolioScenarios, overlay),
    dataChecklist: [
      `${selected.config.catalystName} actual versus consensus`,
      "Front-week ATM implied move",
      "First 30-minute realized move",
      "TNX confirmation",
    ],
    ranking: {
      ...rankingBase,
      composite: compositeScore(rankingBase, baseEvent.watchlistTickers.length, baseEvent.kind),
    },
  };
}

async function buildLiveEarningsEvent(baseEvent: EventCandidate, weekStartDate: string) {
  const weekStart = new Date(`${weekStartDate}T00:00:00.000Z`);
  const weekEnd = addDays(weekStart, 4);
  const upcoming = await fetchFmpEarningsCalendar(isoDate(weekStart), isoDate(weekEnd));
  const uniqueSymbols = [
    ...new Set(upcoming.map((entry) => entry.symbol?.trim().toUpperCase()).filter(Boolean)),
  ] as string[];

  const profiles = new Map<string, FmpProfileEntry | null>();
  await Promise.all(
    uniqueSymbols.map(async (symbol) => {
      try {
        profiles.set(symbol, await fetchFmpProfile(symbol));
      } catch (error) {
        console.error(`weekly-event-lab-live: failed to fetch profile for ${symbol}`, error);
        profiles.set(symbol, null);
      }
    }),
  );

  const candidate = upcoming
    .map((entry) => {
      const symbol = entry.symbol?.trim().toUpperCase();
      if (!symbol) return null;
      const profile = profiles.get(symbol) ?? null;
      const marketCap = toNumber(profile?.mktCap) ?? toNumber(profile?.marketCap) ?? 0;
      const avgVolume = toNumber(profile?.volAvg) ?? toNumber(profile?.avgVolume) ?? 0;

      if (marketCap < 200_000_000_000 || avgVolume < 1_000_000) return null;

      return { entry, symbol, profile, marketCap, avgVolume };
    })
    .filter(
      (
        item,
      ): item is {
        entry: FmpEarningsCalendarEntry;
        symbol: string;
        profile: FmpProfileEntry | null;
        marketCap: number;
        avgVolume: number;
      } => Boolean(item),
    )
    .sort((left, right) => right.marketCap - left.marketCap)[0];

  if (!candidate) return null;

  const playbook = pickEarningsPlaybook(candidate.profile);
  const etfProfile = await fetchFmpProfile(playbook.etfSymbol).catch(() => null);
  const indexProfile = await fetchFmpProfile(playbook.indexSymbol).catch(() => null);
  const historical = await fetchFmpEarningsCalendar(
    isoDate(addDays(weekStart, -720)),
    isoDate(addDays(weekStart, -1)),
  );
  const historicalMatches = historical.filter((entry) => entry.symbol?.trim().toUpperCase() === candidate.symbol);
  const historicalPrior = buildHistoricalPriors(
    ["Beat and lift", "Beat but contained", "Inline / flat", "Miss and unwind"],
    historicalMatches.map((entry) => classifyEarningsScenario(entry)),
  );

  const overlay = buildProbabilityOverlay(
    [
      {
        scenarioName: "Beat and lift",
        historicalPrior: historicalPrior.probabilities["Beat and lift"] ?? 0,
        marketImplied: null,
        note: "Real earnings history for clear positive surprises.",
      },
      {
        scenarioName: "Beat but contained",
        historicalPrior: historicalPrior.probabilities["Beat but contained"] ?? 0,
        marketImplied: null,
        note: "Real earnings history for smaller positive surprises.",
      },
      {
        scenarioName: "Inline / flat",
        historicalPrior: historicalPrior.probabilities["Inline / flat"] ?? 0,
        marketImplied: null,
        note: "Real earnings history for low-information or muted prints.",
      },
      {
        scenarioName: "Miss and unwind",
        historicalPrior: historicalPrior.probabilities["Miss and unwind"] ?? 0,
        marketImplied: null,
        note: "Real earnings history for misses and negative guides.",
      },
    ],
    [],
    0,
    "historical-only",
    "Historical earnings prior",
    `Historical prior from ${historicalPrior.sampleSize} prior ${candidate.symbol} earnings releases. No direct prediction-market contract is blended into this board yet.`,
  );

  const normalizedPlaybook: EarningsPlaybook = {
    ...playbook,
    marketProxy: playbook.marketProxy.replace("PRIMARY", candidate.symbol),
    scenarioMoves: {
      beat: Object.fromEntries(
        Object.entries(playbook.scenarioMoves.beat).map(([key, value]) => [key === "PRIMARY" ? candidate.symbol : key, value]),
      ) as Record<string, number>,
      good: Object.fromEntries(
        Object.entries(playbook.scenarioMoves.good).map(([key, value]) => [key === "PRIMARY" ? candidate.symbol : key, value]),
      ) as Record<string, number>,
      flat: Object.fromEntries(
        Object.entries(playbook.scenarioMoves.flat).map(([key, value]) => [key === "PRIMARY" ? candidate.symbol : key, value]),
      ) as Record<string, number>,
      miss: Object.fromEntries(
        Object.entries(playbook.scenarioMoves.miss).map(([key, value]) => [key === "PRIMARY" ? candidate.symbol : key, value]),
      ) as Record<string, number>,
    },
  };

  const tickerProfiles = buildTickerProfilesForEarnings(
    candidate.symbol,
    candidate.profile?.companyName ?? candidate.symbol,
    candidate.profile,
    etfProfile,
    indexProfile,
    playbook,
  );
  const rankingBase: Omit<ScoreBreakdown, "composite"> = {
    marketImpact: clamp(76 + Math.round(Math.log10(candidate.marketCap) * 3), 76, 94),
    tickerSensitivity: playbook === SEMI_PLAYBOOK ? 92 : 88,
    asymmetry: 87,
    liquidity: computeLiquidityScore(candidate.avgVolume),
    confidence: clamp(62 + Math.min(historicalPrior.sampleSize * 2, 22), 62, 92),
  };

  return {
    ...baseEvent,
    id: `earnings-${candidate.symbol.toLowerCase()}`,
    title: `${candidate.symbol} Earnings Setup`,
    catalystName: `${candidate.symbol} Earnings`,
    eventDate: candidate.entry.date?.slice(0, 10) ?? baseEvent.eventDate,
    eventLabel: candidate.entry.date?.slice(0, 10)
      ? formatDayLabel(candidate.entry.date.slice(0, 10))
      : baseEvent.eventLabel,
    timeLabel: mapTimeLabel(candidate.entry.time, "After close"),
    summary: `${candidate.profile?.companyName ?? candidate.symbol} is the largest liquid earnings catalyst on the board this week, so the play now reflects the incumbent and its adjacent tickers.`,
    whyItMatters: playbook.whyItMatters,
    scope: playbook.scope,
    marketProxy: normalizedPlaybook.marketProxy,
    tags: playbook.tags,
    watchlistTickers: [candidate.symbol, playbook.etfSymbol, playbook.indexSymbol],
    primarySymbol: candidate.symbol,
    scenarioPlanningNote: `Historical priors are seeded from ${historicalPrior.sampleSize} prior ${candidate.symbol} earnings releases. Replace starter premiums with the live chain before sizing.`,
    dataChecklist: playbook.dataChecklist,
    tickerProfiles,
    portfolioLegSeeds: buildPortfolioLegSeeds(candidate.symbol, playbook),
    portfolioScenarios: applyOverlayScenarios(buildEarningsScenarios(normalizedPlaybook), overlay),
    probabilityOverlay: overlay,
    ranking: {
      ...rankingBase,
      composite: compositeScore(rankingBase, 3, "earnings"),
    },
  };
}

function mergeLiveNotes(
  snapshot: WeeklyScanSnapshot,
  flags: { liveCalendars: boolean; historical: boolean; markets: boolean },
) {
  const notes = [...snapshot.notes];

  if (flags.liveCalendars) {
    notes[0] = "Live weekly calendars are active for macro and large-cap earnings when FMP_API_KEY is configured.";
  }
  if (flags.historical) {
    notes[1] = "Historical priors now come from real prior releases or earnings reports where a live seed could be built.";
  }
  if (flags.markets) {
    notes[2] = "Prediction-market inputs are live when the relevant Kalshi or Polymarket identifiers are configured in env vars.";
  }

  return notes;
}

export async function buildResolvedWeeklyScanSnapshot(now = new Date()): Promise<WeeklyScanSnapshot> {
  const seededSnapshot = buildWeeklyScanSnapshot(now);
  const weekStartDate = seededSnapshot.weekStartDate;

  if (!process.env.FMP_API_KEY?.trim()) {
    return seededSnapshot;
  }

  try {
    const liveMacro = await buildLiveMacroEvent(
      seededSnapshot.events.find((event) => event.id === "inflation-reset") ?? seededSnapshot.events[0],
      weekStartDate,
    );
    const liveEarnings = await buildLiveEarningsEvent(
      seededSnapshot.events.find((event) => event.id === "ai-read-through") ?? seededSnapshot.events[1],
      weekStartDate,
    );

    const mergedEvents = seededSnapshot.events
      .map((event) => {
        if (event.id === "inflation-reset" && liveMacro) return liveMacro;
        if (event.id === "ai-read-through" && liveEarnings) return liveEarnings;
        return event;
      })
      .sort((left, right) => right.ranking.composite - left.ranking.composite);

    return {
      ...seededSnapshot,
      generatedAt: new Date().toISOString(),
      dataSources: {
        calendars: liveMacro || liveEarnings ? "live" : "seeded",
        historical: liveMacro || liveEarnings ? "live" : "seeded",
        predictionMarkets: liveMacro?.probabilityOverlay.sources.length ? "live" : "seeded",
        liveEventIds: mergedEvents
          .filter((event) => event.id === liveMacro?.id || event.id === liveEarnings?.id)
          .map((event) => event.id),
      },
      notes: mergeLiveNotes(seededSnapshot, {
        liveCalendars: Boolean(liveMacro || liveEarnings),
        historical: Boolean(liveMacro || liveEarnings),
        markets: Boolean(liveMacro?.probabilityOverlay.sources.length),
      }),
      events: mergedEvents,
    };
  } catch (error) {
    console.error("weekly-event-lab-live: failed to build live snapshot, falling back to seeded snapshot", error);
    return seededSnapshot;
  }
}

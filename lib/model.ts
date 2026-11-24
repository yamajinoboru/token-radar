// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol
// is pre-token when its record carries no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown at their market values, never ranked.
//
// The implied value is built from the snapshot's own figures, in four factors:
//
//   multiple   the price of a dollar of TVL in the protocol's own category, taken from the
//              snapshot itself: the median market-cap / TVL ratio of the category's live-token
//              protocols (at least three of them, else the all-category median), winsorised to
//              [0.05, 2.5] so one outlier cannot carry a category.
//   growth     the week's TVL change, clamped to [-50, +100] per cent, at weight 0.6:
//              1 + (growth / 100) x 0.6, so a hot week lifts a value and a bad week dents it.
//   maturity   a protocol that has run longer with no token has more to show for a launch:
//              0.70 + 0.30 x min(age_days, 1460) / 1460; an unknown age scores a neutral 0.85.
//   breadth    each chain past the first adds reach: 1 + 0.04 x min(chains - 1, 4).
//
//   implied    = max(1, round(tvl_usd x multiple x growth x maturity x breadth))
//
// No protocol name is ever special-cased: the same function scores every row, and the dashboard
// shows each row's four factors so a reader can rebuild its number from the snapshot alone.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and the board's rows carry it. */
export const MODEL_VERSION = 'radar-2';

/** How many rows the board carries in all: the watchlist plus the strongest early rows. */
export const BOARD_ROWS = 240;

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The multiple's winsorising bounds and the smallest category sample that earns its own median. */
export const MULTIPLE_MIN = 0.05;
export const MULTIPLE_MAX = 2.5;
export const CATEGORY_MIN_SAMPLES = 3;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_factor: number;
    maturity_factor: number;
    breadth_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row: the board row's figures, its factors and its farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** One category's comparable multiple, as the model page shows it. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  samples: number;
  own: boolean;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  universe_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  multiples: CategoryMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const clampMultiple = (n: number): number => Math.min(MULTIPLE_MAX, Math.max(MULTIPLE_MIN, n));

/**
 * The category multiples, derived from the snapshot: for every category, the median market-cap /
 * TVL ratio of its live-token protocols with both figures positive. A category with fewer than
 * CATEGORY_MIN_SAMPLES comparables falls back to the all-category median and is marked not its own.
 */
export function categoryMultiples(protocols: SnapshotProtocol[]): { byCategory: Map<string, CategoryMultiple>; global: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0 || p.category === null || p.category === 'CEX') continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    const list = ratios.get(p.category) ?? [];
    list.push(ratio);
    ratios.set(p.category, list);
    all.push(ratio);
  }
  const global = clampMultiple(all.length > 0 ? median(all) : 0.25);
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, list] of ratios) {
    if (list.length >= CATEGORY_MIN_SAMPLES) {
      byCategory.set(category, { category, multiple: clampMultiple(median(list)), samples: list.length, own: true });
    } else {
      byCategory.set(category, { category, multiple: global, samples: list.length, own: false });
    }
  }
  return { byCategory, global };
}

/** The four factors and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: { byCategory: Map<string, CategoryMultiple>; global: number },
): { implied: number; multiple: number; growthPct: number; growthFactor: number; maturityFactor: number; breadthFactor: number; age: number | null } {
  const multiple = (protocol.category !== null ? multiples.byCategory.get(protocol.category)?.multiple : undefined) ?? multiples.global;
  const growthPct = Math.min(100, Math.max(-50, finite(protocol.change_7d, 0)));
  const growthFactor = 1 + (growthPct / 100) * 0.6;
  const age = ageDays(asOf, protocol.listed_at);
  const maturityFactor = age === null ? 0.85 : 0.7 + 0.3 * (Math.min(age, 1460) / 1460);
  const breadthFactor = 1 + 0.04 * Math.min(Math.max(protocol.chains.length - 1, 0), 4);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthFactor * maturityFactor * breadthFactor));
  return { implied, multiple, growthPct, growthFactor, maturityFactor, breadthFactor, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist rule keeps off the board: wrapped, staked and bridged products, and exchanges. */
const UNRANKED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** A whole word wrapped, staked or staking in a name, in any case: a product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a protocol may not begin with: its product is the exchange's, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)(\s|$|[^A-Za-z])/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not — by the watchlist rule's own
 * tests — a wrapped, staked or bridged product of a token that already trades, a versioned pool of
 * another protocol, or an exchange's own product.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    (p.category === null || !UNRANKED_CATEGORIES.has(p.category)) &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const multiples = categoryMultiples(snapshot.protocols);
  const index = bySlug(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, scored, and the strongest kept until
  // the board is full. A watchlist row is never displaced by an early one.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .map((p) => ({ p, score: impliedValue(p, snapshot.as_of, multiples) }))
    .sort((a, b) => b.score.implied - a.score.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  for (const e of early) {
    if (chosen.size >= BOARD_ROWS) break;
    chosen.set(e.p.slug, e.p);
  }
  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, multiples) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: round4(s.multiple),
      growth_pct: s.growthPct,
      growth_factor: round4(s.growthFactor),
      maturity_factor: round4(s.maturityFactor),
      breadth_factor: round4(s.breadthFactor),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The chains a step can name: the first two the protocol lists, in its own words. */
function chainNames(p: SnapshotProtocol): string[] {
  return p.chains.length > 0 ? p.chains.slice(0, 2) : ['its main chain'];
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 50;
  return 25;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's two moves, in the words a farmer can follow: an opening position and a second action. */
function actionsFor(p: SnapshotProtocol, capital: number, chains: string[]): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const [first, second] = [chains[0]!, chains[1] ?? chains[0]!];
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return [
      `Supply $${capital} of USDC to ${name} on ${first} and keep the deposit open.`,
      `Borrow a small amount, about 20% of the deposit, against it on ${name} and repay within the week, so both sides of the market see the wallet.`,
    ];
  if (c.includes('dex') || c.includes('leveraged farm'))
    return [
      `Provide $${capital} of liquidity to ${name}'s most-used pool on ${first} and keep the position open.`,
      `Make two or three small swaps through ${name} on ${second} in the same week, the route a regular trader would take.`,
    ];
  if (c.includes('staking') || c.includes('restak'))
    return [
      `Stake $${capital} of the chain's staking asset through ${name} on ${first} and keep the receipt token in the wallet.`,
      `Restake or delegate a second, smaller tranche on ${second} if ${name} runs there, and leave both tranches untouched.`,
    ];
  if (c.includes('bridge') || c.includes('canonical'))
    return [
      `Bridge $${capital} of USDC from Ethereum to ${second} through ${name} and keep the bridged funds working there.`,
      `Bridge a smaller amount back a week later, so the wallet shows traffic in both directions.`,
    ];
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options'))
    return [
      `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`,
      `Trade a second small position the following week and close both flat, keeping the volume modest and regular.`,
    ];
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield'))
    return [
      `Deposit $${capital} into a ${name} vault on ${first} and keep the vault shares in the wallet.`,
      `Move a quarter of the position into a second ${name} vault on ${second} after two weeks, so the wallet holds more than one vault.`,
    ];
  if (c.includes('rwa'))
    return [
      `Mint $${capital} of ${name}'s yield asset on ${first} and hold it in the wallet.`,
      `Hold the asset through one full distribution cycle before redeeming any of it.`,
    ];
  if (c.includes('stable'))
    return [
      `Mint or deposit $${capital} of the stable asset through ${name} on ${first}.`,
      `Use the minted asset in one partner integration ${name} names on its own page, so the wallet shows a real use, not a park.`,
    ];
  if (c.includes('insurance'))
    return [
      `Buy $${capital} of cover from ${name} on ${first} for a position you actually hold.`,
      `Renew the cover once when it lapses, so the wallet shows a second policy period.`,
    ];
  if (c.includes('prediction'))
    return [
      `Fund $${capital} and take one position in a liquid market on ${name}.`,
      `Settle that position and take a second one in a different market the next week.`,
    ];
  if (c.includes('nft') || c.includes('gaming') || c.includes('game'))
    return [
      `Spend about $${Math.max(10, Math.round(capital / 5))} on a first in-app purchase or mint on ${name} on ${first}.`,
      `Play or use ${name} in three separate sessions across two weeks, the pattern of a real user.`,
    ];
  return [
    `Deposit $${capital} of USDC into ${name} on ${first} and keep the position open.`,
    `Repeat a smaller deposit on ${second} two weeks later, so the wallet shows a returning user, not a drive-by.`,
  ];
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chains = chainNames(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const [open, second] = actionsFor(p, capital, chains);
  const gas = capital >= 150 ? 8 : capital >= 50 ? 4 : 2;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm ${p.name} with, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: open,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: `about $${Math.max(2, Math.round(gas / 2))} of gas`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week after that, such as a deposit, a swap, a vote or a claim, so the wallet reads as an active user of ${p.name}.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot of ${p.name}'s usage.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes; then unwind in two steps a day apart and log every transaction.`,
      cost: 'no fee to check, and never pay to claim',
      time: '15 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const multiples = categoryMultiples(snapshot.protocols);
  const early = board.filter((r) => !r.watchlist).length;
  const table = [...multiples.byCategory.values()]
    .filter((m) => m.samples > 0)
    .sort((a, b) => b.samples - a.samples || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    universe_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: round4(multiples.global),
    multiples: table,
    rows: board.map((row) => ({
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      listed_at: row.listed_at,
      age_days: row.age_days,
      watchlist: row.watchlist,
      implied_value_usd: row.implied_value_usd,
      category_multiple: row.model.category_multiple,
      growth_factor: row.model.growth_factor,
      maturity_factor: row.model.maturity_factor,
      breadth_factor: row.model.breadth_factor,
      farm_steps: row.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is missing`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

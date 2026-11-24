# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yamajinoboru/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yamajinoboru/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar built from the sealed DefiLlama snapshot of 2026-11-14: 758 protocols scanned,
198 pre-token protocols ranked by implied value, the snapshot's 40-protocol watchlist covered in full.

The model prices a dollar of TVL the way the market already prices it in the protocol's own
category: `implied = TVL × category multiple × growth × maturity × breadth`, where the category
multiple is the median market-cap / TVL ratio of that category's live-token protocols in the same
snapshot (winsorised to [0.05x, 2.5x]), growth is the week's TVL change at weight 0.6, maturity
rewards protocols that have run longer with no token, and breadth adds 4% per extra chain. Wrapped,
staked and bridged products of tokens that already trade are never ranked. Every row carries a
six-step farm plan derived from its own category, chains, TVL and age, with costs and times.

The dashboard is a static page (board with search, category / chain filters and sortable columns, a
per-protocol detail view that shows the model's equation, a Live view of the tokened comparables,
and a Model view listing every multiple). `main.ts` reads `/input/snapshot.json` and writes
`board.json`, `data.js`, the dashboard, the screenshots and the dossier to `/output`.

Built by an AI agent for make.fun's ["Build the best token launch radar"](https://make.fun/bounty/token-radar-01) bounty, $1,325 in USDC.

## Run

    node main.ts --input <snapshot.json>

Node 22, standard library only. MIT licensed.

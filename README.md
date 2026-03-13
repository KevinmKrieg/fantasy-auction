# fantasy-auction

Local draft helper for fantasy football auction leagues. Upload projection CSV data, map the relevant columns, and generate expected and ceiling-based auction values for each player.

## What it does

- Imports a CSV from your projection source.
- Lets you choose which columns represent player name, team, position, expected points, ceiling points, and an optional target price.
- Converts projections into auction prices using roster demand plus above-replacement value.
- Shows an `expected` price and a `ceiling` price for every player.
- Filters the board by player name, team, and position.
- Lets you mark players as drafted with an optional sale price, then removes them from the live board.
- Keeps a drafted-player ledger and recalculates the remaining market after each removal.

## Auction model

This first version uses a straightforward local model:

1. Roster demand is determined from your league settings.
2. Starter spots, flex, superflex, and bench spots are allocated across the uploaded player pool.
3. Replacement level is set by the last drafted player at each position.
4. Each player's positive points above replacement are converted into dollars.
5. Every roster spot gets a minimum `$1`, and the remaining league budget is distributed across positive-value players.

The result is:

- `Expected $`: price from your expected-points column.
- `Ceiling $`: price from your ceiling-points column.
- `Range`: quick view of the expected-to-ceiling spread.

## Running locally

No build step is required. You can either open `index.html` directly or serve the folder locally:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## CSV expectations

The app does not depend on exact header names. After upload, you map the relevant columns yourself.

Required logical fields:

- player name
- team
- position
- expected points
- ceiling points

Optional field:

- target `$`

A sample dataset is included in the app through the `Load sample data` button so the interface can be tested immediately.

## Next useful improvements

- scoring-system-aware point generation from raw stat projections
- custom bench allocation rules by position
- keeper inflation and nomination strategy support
- tiering and player notes

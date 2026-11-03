# Analytics test fixtures

Every file here is **fictional**, written by hand with round numbers so the answers can be worked out on paper. In each row, open, high, low and close are equal, and volume is 1000. None is real market data.

| File | Closes | Tests |
|---|---|---|
| `constant_21.csv` | 100 throughout | All returns, the standard deviation and the drawdown are 0 |
| `doubling_21.csv` | 1, 2, 4 … 2^20 | Strictly rising: every return +100%, cumulative 2^20 − 1, drawdown 0 |
| `halving_21.csv` | 2^20 … 2, 1 | Falling: every return −50%, drawdown equals the cumulative return |
| `drawdown_recovery.csv` | 100, 120, 90, 60, 90, 120, 150 | Drawdown −50% (peak 120, trough 60), kept after the later recovery |
| `alternating_21.csv` | 100, 125, 100 … | **Exactly 20 returns:** +25% and −20%, standard deviation √(1.0125 / 19) |
| `alternating_20.csv` | The first 20 of the above | **19 returns:** the standard deviation is not calculated |
| `single_row.csv` | 100 | The shortest valid import: no return can be calculated |
| `two_rows.csv` | 100, 110 | The shortest sample with a return |
| `gap_sessions.csv` | 100, 110, 99, 99 | Sessions missing between rows: 3 returns from 4 rows, largest gap 10 days |

`expected.json` holds the answers, also for `../import/valid_daily_250.csv` and `../import/short_15.csv`. `tests/test_analytics_oracle.py` recomputes them in exact rational arithmetic, sharing no code with `web/lib/analytics.ts`.

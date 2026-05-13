# NQ Backtester

Standalone Next.js app for replaying and backtesting E-mini Nasdaq-100 futures data.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Local CSV

The local data route reads:

```txt
/Users/vincentla/Downloads/Dataset_NQ_1min_2022_2025.csv
```

To point it at another local file, set `NQ_LOCAL_CSV_PATH`.

You can still import another CSV from the app toolbar.

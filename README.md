# TestMaker (Fix2 Branch)

Automated Test Analysis Tool with recursive discovery and element capture.

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure Environment:
   Create a `.env` file with the following:
   ```env
   TESTMAKER_URL=https://stage.ianai.co
   emailname=your_email@example.com
   password=your_password
   ```

## Usage

Run the analysis using `npm run analyze`. You can pass arguments after `--`.

### Basic Usage
(Uses URL from `.env`)
```bash
npm run analyze
```

### With Explicit URL
(Overrides `.env` setting)
```bash
npm run analyze -- --url "https://stage.ianai.co"
```

### Recursive Discovery (Deep Scan)
Explore links found on pages up to a certain depth and limit.
```bash
npm run analyze -- --recursive --depth 3 --limit 100
```
- `--depth`: How many clicks deep to go (Default: 1).
- `--limit`: Max number of pages to analyze (Default: 50).

### General Recursive Discovery With URL
```bash
npm run analyze -- --url "https://stage.ianai.co" --recursive --depth 3 --limit 100 --force
```

### Command Options Reference (`src/cli.ts`)
| Option | Description | Default |
|--------|-------------|---------|
| `--url` | Target URL | `process.env.TESTMAKER_URL` |
| `--recursive` | Enable link following | `false` |
| `--depth` | Max traversal depth | `1` |
| `--limit` | Max pages to visit | `50` |
| `--output-dir` | Directory for results | `./output` |
| `--auth-file` | Path to storage state | `process.env.TESTMAKER_AUTH_FILE` |
| `--timeout` | Page timeout (seconds) | `180` |

## Troubleshooting
**"Why fewer pages found?"**
- Ensure `--recursive` is set.
- Check if `.env` has the correct `TESTMAKER_URL`.
- If menus aren't clicking, check `src/scraper.ts` for logic issues (Fixed in `fix2`).

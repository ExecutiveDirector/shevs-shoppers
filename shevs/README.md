# Shevs

An online shop for Kenya: a static storefront, an admin panel, and an
Express/MySQL API behind them. Orders are confirmed over WhatsApp rather
than through a payment gateway.

## Why this isn't "all hosted on GitHub"

GitHub stores code and can serve **static** files (HTML/CSS/JS with no
server) via GitHub Pages. It can't run a Node process or a MySQL database —
there's nothing there to execute your backend or hold your data. So the
real setup is:

| Piece | What it is | Where it actually runs |
|---|---|---|
| `frontend/` | The shop — static HTML | **GitHub Pages** (free) |
| `admin/` | Order management panel — static HTML | **GitHub Pages** (free, same site) |
| `backend/` | Express API | **Render** (or Railway/Fly.io) — runs your Node process |
| Database | MySQL | **Render MySQL / PlanetScale / Railway** — a managed database host |

GitHub is the single source of truth for all the code, and both Render and
GitHub Pages redeploy automatically from it on every push — so day to day
it *feels* like "it's all on GitHub," even though two other free/cheap
services are doing the actual running.

## Repo layout

```
shevs/
  frontend/   the storefront (index.html — open this to shop)
  admin/      the admin panel (index.html — enter your API URL + admin key)
  backend/    Express API + MySQL migrations (see backend/README.md)
  .github/workflows/
    pages.yml        auto-deploys frontend/ + admin/ to GitHub Pages on push
    backend-ci.yml    syntax-checks the backend on push
```

## First-time setup

### 1. Push this to GitHub

```bash
cd shevs
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

### 2. Turn on GitHub Pages

Repo → **Settings → Pages** → under "Build and deployment", set **Source**
to **GitHub Actions**. The `pages.yml` workflow in this repo will then
build and deploy `frontend/` (as the site root) and `admin/` (at `/admin/`)
automatically every time you push to `main`. After the first run, your
site is live at `https://<your-username>.github.io/<repo-name>/` and the
admin panel at `.../admin/`.

### 3. Set up the database

Create a MySQL database on Render, PlanetScale, or Railway — whichever you
prefer. Note the host, port, user, password, and database name.

### 4. Deploy the backend to Render

1. Render dashboard → **New → Web Service** → connect this GitHub repo.
2. **Root directory:** `backend`
3. **Build command:** `npm install`
4. **Start command:** `npm start`
5. Add every variable from `backend/.env.example` under Environment, with
   real values. For `CORS_ORIGIN`, use your GitHub Pages origin —
   `https://<your-username>.github.io` (no path needed; the same origin
   covers both `/` and `/admin/`, since CORS only looks at scheme+host).
6. Deploy. Render will redeploy automatically on every push to `main`
   that touches `backend/`.
7. Run the database migration once, from your own machine, pointed at the
   production database:
   ```bash
   cd backend
   cp .env.example .env   # fill in the production DB_* values
   npm install
   npm run migrate
   ```

### 5. Connect the frontend to the live backend

Open `frontend/index.html`, find:

```js
const API_BASE="";
```

and set it to your Render URL, e.g. `"https://shevs-api.onrender.com"`.
Commit and push — the frontend redeploys automatically and checkout now
hits the real API instead of demo mode.

The admin panel needs no code change: it asks for the API URL and admin
key the first time you open it and remembers them in that browser.

## Day-to-day use

- **New product, price change, restock:** for now, directly in the
  database (HeidiSQL, TablePlus, or `mysql` CLI) — same pattern already
  used for AquaGas. A product-editing screen in the admin panel is a
  natural next step once this is live.
- **An order comes in on WhatsApp:** agree payment with the customer,
  then open the admin panel, find the order, and mark it `confirmed` (or
  `dispatched` / `delivered` as it moves along).
- **Something breaks:** check Render's logs for the backend; GitHub's
  Actions tab for a failed Pages deploy or CI run.

## What's genuinely verified vs. not

Everything in `backend/` was executed against stub dependencies and an
in-memory fake database in a sandboxed environment with no network access
— so the request/response wiring, the transaction and stock-locking logic,
and the admin panel's API calls were all exercised and passed. What was
**not** possible to verify from there: a real MySQL connection, a real
HTTP deployment, or opening any of this in an actual browser. Test the
full path yourself — place a real demo order end to end — before treating
this as done.

# Shevs API

Node.js/Express + MySQL backend for the Shevs storefront. No payment gateway —
checkout creates a `pending` order and hands the customer off to WhatsApp to
confirm payment with the shop owner directly.

## Stack
- Node.js 18+, Express
- MySQL (via `mysql2`)
- No ORM — plain parameterized SQL, kept close to the schema in `migrations/`

## Local setup

```bash
npm install
cp .env.example .env     # then fill in real values
mysql -u root -p -e "CREATE DATABASE shevs"
npm run migrate           # applies migrations/001_init.sql and 002_seed.sql
npm run dev                # starts on http://localhost:4000
```

`npm run migrate` is safe to re-run: applied migrations are recorded in a
`schema_migrations` table and skipped next time. A database that was set up
by hand before this tracker existed is detected and adopted automatically.
On Railway it runs as the **pre-deploy command**, so every deploy applies any
new migration before the new code starts (a failed migration aborts the deploy
and the old version keeps serving).

Run the API tests (no database needed — MySQL is stubbed) with `npm test`.

## Environment variables

See `.env.example` for the full list. The two easiest to get wrong:

- `WHATSAPP_NUMBER` must be digits only (`254712345678`, not `+254 712 345
  678` or a placeholder with letters) — anything non-numeric gets silently
  stripped and breaks the WhatsApp link. The server warns on startup if this
  looks wrong.
- `ADMIN_API_KEY` protects every `/api/admin/*` route. It is compared in
  constant time, and repeated wrong guesses are rate-limited. Generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

## API

All customer-facing routes are under `/api`. All responses are JSON; errors
come back as `{ "error": { "message": "...", "details": [...] } }`.

| Method | Path                         | Purpose                                      |
|--------|------------------------------|-----------------------------------------------|
| GET    | `/api/products`              | List products — `?category=`, `?q=`, `?minPrice=`, `?maxPrice=`, `?minRating=`, `?onSale=true`, `?sort=rel\|price_asc\|price_desc\|rating\|discount`, `?page=`, `?pageSize=` |
| GET    | `/api/products/:id`          | One product + related items from its category |
| GET    | `/api/categories`             | List categories with live product counts      |
| POST   | `/api/coupons/validate`       | Check a coupon code against a subtotal        |
| POST   | `/api/orders`                 | Create an order. See below.                   |
| GET    | `/api/orders/:code`           | Look up an order by its code (e.g. `SHV-K7M2QX`) |
| GET    | `/api/settings`               | Public shop settings (name, WhatsApp number, delivery fee, free-delivery threshold) |
| GET    | `/api/health`                 | Liveness; add `?deep=1` to also check the database |

Shevs is a single shop, not a marketplace: there are no sellers or vendor
accounts, and one shared admin key manages everything.

### Admin API

All admin routes need an `x-admin-key: <ADMIN_API_KEY>` header.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/stats` | Dashboard numbers: sales by period, status counts, 14-day series, best sellers, stock alerts, inventory value |
| GET | `/api/admin/orders` | List orders — `?status=`, `?q=` (code/name/phone), `?from=&to=` (YYYY-MM-DD), `?page=`, `?pageSize=`; returns `total` |
| GET | `/api/admin/orders/:code` | Full order with customer details and items |
| PATCH | `/api/admin/orders/:code/status` | Change status. Cancelling returns stock; re-opening takes it out again |
| PATCH | `/api/admin/orders/:code/note` | Save a private note on an order |
| GET | `/api/admin/products` | List all products (incl. hidden) — `?q=`, `?category=`, `?state=active\|hidden\|featured\|low\|out\|noimage\|nocost`, `?sort=`, `?page=` |
| GET | `/api/admin/products/:id` | Product + sales performance + stock history |
| POST | `/api/admin/products` | Create (name, categoryId, price, optional SKU/brand/description/imageUrl/costPrice/tags/…) |
| PATCH | `/api/admin/products/:id` | Update any product field |
| POST | `/api/admin/products/:id/stock` | Adjust stock: `{mode: "add"\|"set", qty, reason, note}` — every change is logged |
| POST | `/api/admin/products/:id/duplicate` | Copy a product (hidden, no stock) |
| POST | `/api/admin/products/bulk` | `{ids, action: show\|hide\|feature\|unfeature\|category\|delete, categoryId?}` |
| DELETE | `/api/admin/products/:id` | Delete a product (past orders keep their snapshots) |
| GET/POST/PATCH/DELETE | `/api/admin/categories[/:id]` | Manage categories (can't delete one that still has products) |
| GET/POST/PATCH/DELETE | `/api/admin/coupons[/:id]` | Manage coupons |
| GET | `/api/admin/customers` | Customers grouped by phone — orders, total spent |
| GET/PATCH | `/api/admin/settings` | Shop name, WhatsApp number, delivery fee, free-delivery threshold, low-stock default |

### `POST /api/orders`

```json
{
  "customerName": "Jane Doe",
  "phone": "0712345678",
  "county": "Nairobi",
  "address": "Apartment 4B, Example Rd",
  "paymentMethod": "mpesa",
  "couponCode": "WELCOME200",
  "items": [{ "productId": 12, "qty": 2 }]
}
```

Only `productId` and `qty` are trusted from the client — price, stock, and
the coupon discount are all re-derived from the database inside a single
transaction, with the relevant product rows locked (`SELECT ... FOR UPDATE`)
so two simultaneous orders can't both succeed against the last unit of
stock. The response includes a ready-to-use `whatsappUrl` pre-filled with
the order summary.

## Admin workflow

The `admin/` app in the repo root is a static panel for viewing orders and
updating their status (`pending` → `confirmed` → `dispatched` →
`delivered`), backed by the two admin routes below. It needs no setup
beyond an API URL and the admin key, entered once in the browser.

For anything the panel doesn't cover yet (editing products, for instance),
fall back to `curl` or editing the tables directly — same pattern already
used for AquaGas via HeidiSQL:

```bash
curl -X PATCH https://your-api/api/admin/orders/SHV-123456/status \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"confirmed"}'
```

## Deploying

See the repo root `README.md` for the full setup (GitHub → Render →
database → connecting the frontend). The short version for this folder
specifically: Render Web Service with **root directory** set to `backend`,
build command `npm install`, start command `npm start`, and every variable
from `.env.example` filled in under Environment.

## Known limitations (by design, for now)

- No payment gateway — intentional, per the current WhatsApp-confirmation flow.
- No admin dashboard UI — order management is via `curl`/HeidiSQL for now.
- No customer accounts — orders are looked up by code, not by login.
- Search is a simple SQL `LIKE` match, not the fuzzy/typo-tolerant search
  the storefront's demo mode does client-side. Fine at this catalog size;
  worth a real search index (e.g. MySQL `FULLTEXT`, or Meilisearch) if the
  catalog grows into the thousands.

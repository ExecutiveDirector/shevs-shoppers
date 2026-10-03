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

`npm run migrate` is safe to re-run for the schema file, but **not** for
`002_seed.sql` — it will insert duplicate categories/products if run twice
against a database that already has them. Only run migrations against a
fresh database, or remove `002_seed.sql` after the first run.

## Environment variables

See `.env.example` for the full list. The two easiest to get wrong:

- `WHATSAPP_NUMBER` must be digits only (`254712345678`, not `+254 712 345
  678` or a placeholder with letters) — anything non-numeric gets silently
  stripped and breaks the WhatsApp link. The server warns on startup if this
  looks wrong.
- `ADMIN_API_KEY` protects the two admin routes (list orders, update order
  status). Generate one with:
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
| GET    | `/api/orders/:code`           | Look up an order by its code (e.g. `SHV-123456`) |
| GET    | `/api/admin/orders`           | **Admin.** List orders — `?status=`, `?page=` |
| PATCH  | `/api/admin/orders/:code/status` | **Admin.** Update status (`pending`/`confirmed`/`dispatched`/`delivered`/`cancelled`) |

Admin routes require an `x-admin-key: <ADMIN_API_KEY>` header.

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

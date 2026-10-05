-- The starter catalog (002_seed.sql) shipped with invented star ratings and
-- review counts. The shop has no review system, so showing them would
-- misrepresent products. Clear them; the storefront hides ratings when the
-- review count is 0.
UPDATE products SET rating = 0, rating_count = 0;
ALTER TABLE products ALTER COLUMN rating SET DEFAULT 0;

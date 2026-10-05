-- Richer product records, a stock history, shop settings and order notes.
-- Applied once by scripts/migrate.js (tracked in schema_migrations).

ALTER TABLE products
  ADD COLUMN sku                 VARCHAR(40)   NULL AFTER name,
  ADD COLUMN brand               VARCHAR(80)   NULL AFTER sku,
  ADD COLUMN description         TEXT          NULL,
  ADD COLUMN image_url           VARCHAR(500)  NULL,
  ADD COLUMN cost_price          DECIMAL(10,2) NULL,
  ADD COLUMN low_stock_threshold INT           NULL,
  ADD COLUMN featured            TINYINT(1)    NOT NULL DEFAULT 0,
  ADD COLUMN tags                VARCHAR(255)  NULL,
  ADD UNIQUE KEY uq_products_sku (sku);

CREATE TABLE IF NOT EXISTS stock_log (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  product_id   INT NOT NULL,
  change_qty   INT NOT NULL,
  stock_after  INT NOT NULL,
  reason       ENUM('restock','sale','cancel','reopen','correction','damaged','return','other') NOT NULL,
  note         VARCHAR(200) NULL,
  order_code   VARCHAR(20)  NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_stocklog_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_stocklog_product (product_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  setting_key    VARCHAR(60)  NOT NULL PRIMARY KEY,
  setting_value  VARCHAR(500) NOT NULL,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE orders
  ADD COLUMN admin_note VARCHAR(500) NULL,
  ADD INDEX idx_orders_created (created_at);

-- Shevs shop schema
-- Run this once against an empty database, e.g.:
--   mysql -u root -p shevs < migrations/001_init.sql

CREATE TABLE IF NOT EXISTS categories (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(80) NOT NULL,
  icon        VARCHAR(8)  NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS products (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  category_id        INT NOT NULL,
  name               VARCHAR(160) NOT NULL,
  emoji              VARCHAR(8) NOT NULL DEFAULT '',
  price              DECIMAL(10,2) NOT NULL,
  compare_at_price   DECIMAL(10,2) NOT NULL,
  stock              INT NOT NULL DEFAULT 0,
  rating             DECIMAL(2,1) NOT NULL DEFAULT 4.5,
  rating_count       INT NOT NULL DEFAULT 0,
  eta_label          VARCHAR(40) NOT NULL DEFAULT '2–4 days',
  active             TINYINT(1) NOT NULL DEFAULT 1,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id),
  INDEX idx_products_category (category_id),
  INDEX idx_products_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS coupons (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  code             VARCHAR(40) NOT NULL UNIQUE,
  discount_amount  DECIMAL(10,2) NOT NULL,
  min_subtotal     DECIMAL(10,2) NOT NULL DEFAULT 0,
  active           TINYINT(1) NOT NULL DEFAULT 1,
  expires_at       DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  order_code       VARCHAR(20) NOT NULL UNIQUE,
  customer_name    VARCHAR(80) NOT NULL,
  phone            VARCHAR(20) NOT NULL,
  county           VARCHAR(40) NOT NULL,
  address          VARCHAR(200) NOT NULL,
  payment_method   ENUM('mpesa','cod') NOT NULL,
  status           ENUM('pending','confirmed','dispatched','delivered','cancelled') NOT NULL DEFAULT 'pending',
  subtotal         DECIMAL(10,2) NOT NULL,
  delivery_fee     DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount         DECIMAL(10,2) NOT NULL DEFAULT 0,
  coupon_code      VARCHAR(40) NULL,
  total            DECIMAL(10,2) NOT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_orders_status (status),
  INDEX idx_orders_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_items (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  order_id              INT NOT NULL,
  product_id            INT NULL,
  name_snapshot         VARCHAR(160) NOT NULL,
  unit_price_snapshot   DECIMAL(10,2) NOT NULL,
  qty                   INT NOT NULL,
  line_total            DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  INDEX idx_items_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO coupons (code, discount_amount, min_subtotal, active)
VALUES ('WELCOME200', 200.00, 1000.00, 1)
ON DUPLICATE KEY UPDATE discount_amount = VALUES(discount_amount);

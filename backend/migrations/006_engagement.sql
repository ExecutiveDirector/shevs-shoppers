-- Customer receipts, back-in-stock signups, verified reviews, banners and promotions.
ALTER TABLE orders ADD COLUMN customer_email VARCHAR(120) NULL;

CREATE TABLE IF NOT EXISTS stock_alerts (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id  INT NOT NULL,
  contact     VARCHAR(120) NOT NULL,
  kind        ENUM('email','phone') NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notified_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_alert (product_id, contact),
  INDEX idx_alert_pending (notified_at),
  CONSTRAINT fk_alert_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reviews (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id  INT NOT NULL,
  order_id    INT NOT NULL,
  name        VARCHAR(60) NOT NULL,
  rating      TINYINT UNSIGNED NOT NULL,
  comment     VARCHAR(1000) NULL,
  status      ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_review (product_id, order_id),
  INDEX idx_review_status (status, created_at),
  CONSTRAINT fk_review_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS banners (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title       VARCHAR(80) NOT NULL,
  subtitle    VARCHAR(160) NULL,
  image_url   VARCHAR(500) NULL,
  link_type   ENUM('none','category','product') NOT NULL DEFAULT 'none',
  link_id     INT UNSIGNED NULL,
  starts_at   DATETIME NULL,
  ends_at     DATETIME NULL,
  active      TINYINT(1) NOT NULL DEFAULT 1,
  sort_order  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS promotions (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80) NOT NULL,
  percent_off TINYINT UNSIGNED NOT NULL,
  scope       ENUM('all','category','product') NOT NULL DEFAULT 'all',
  scope_id    INT UNSIGNED NULL,
  min_qty     SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  starts_at   DATETIME NULL,
  ends_at     DATETIME NULL,
  active      TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

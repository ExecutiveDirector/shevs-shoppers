-- Several photos per product (optionally labelled with a colour) and sizes with their own price and stock.
CREATE TABLE IF NOT EXISTS product_photos (
  id          INT NOT NULL AUTO_INCREMENT,
  product_id  INT NOT NULL,
  url         VARCHAR(500) NOT NULL,
  color       VARCHAR(40)  NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_photos_product (product_id, sort_order),
  CONSTRAINT fk_photos_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS product_variants (
  id                INT NOT NULL AUTO_INCREMENT,
  product_id        INT NOT NULL,
  label             VARCHAR(60)  NOT NULL,           -- the size: "Small", "500ml", "Queen"
  sku               VARCHAR(40)  NULL,
  cost_price        DECIMAL(10,2) NULL,                -- what this size costs you, kept private
  price             DECIMAL(10,2) NOT NULL,
  compare_at_price  DECIMAL(10,2) NOT NULL,
  stock             INT NOT NULL DEFAULT 0,
  sort_order        INT NOT NULL DEFAULT 0,
  active            TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_variant_label (product_id, label),
  CONSTRAINT fk_variants_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Orders remember which size/colour was bought. name_snapshot also carries it, e.g. "Bedsheet (Queen, Red)".
ALTER TABLE order_items
  MODIFY name_snapshot VARCHAR(255) NOT NULL,
  ADD COLUMN variant_id INT NULL,
  ADD COLUMN color VARCHAR(40) NULL,
  ADD CONSTRAINT fk_items_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL;

-- Colours a customer can pick (comma separated). Photos can be tagged with one of them.
ALTER TABLE products ADD COLUMN colors VARCHAR(255) NULL;

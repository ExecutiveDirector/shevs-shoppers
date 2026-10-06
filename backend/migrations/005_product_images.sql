-- Uploaded product photos, resized on upload and stored in the database so they
-- survive redeploys (the hosting disk is wiped on every deploy).
CREATE TABLE IF NOT EXISTS product_images (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  large       MEDIUMBLOB   NOT NULL,
  thumb       MEDIUMBLOB   NOT NULL,
  width       SMALLINT UNSIGNED NOT NULL,
  height      SMALLINT UNSIGNED NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Customer accounts (sign in with phone or email + password) and order history.
CREATE TABLE IF NOT EXISTS users (
  id             INT NOT NULL AUTO_INCREMENT,
  name           VARCHAR(80)  NOT NULL,
  phone          VARCHAR(15)  NOT NULL,           -- normalised: 2547XXXXXXXX / 2541XXXXXXXX
  email          VARCHAR(120) NULL,
  password_hash  VARCHAR(200) NOT NULL,
  county         VARCHAR(40)  NULL,
  address        VARCHAR(200) NULL,
  reset_hash     VARCHAR(100) NULL,
  reset_expires  DATETIME     NULL,
  reset_tries    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at  TIMESTAMP    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_phone (phone),
  UNIQUE KEY uq_user_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE orders ADD COLUMN user_id INT NULL,
  ADD INDEX idx_orders_user (user_id),
  ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

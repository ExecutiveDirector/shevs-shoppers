-- Sign in / register with Google. Google accounts have no password, and may have no phone yet.
ALTER TABLE users
  MODIFY phone VARCHAR(15) NULL,
  MODIFY password_hash VARCHAR(200) NULL,
  ADD COLUMN google_id VARCHAR(40) NULL,
  ADD UNIQUE KEY uq_user_google (google_id);

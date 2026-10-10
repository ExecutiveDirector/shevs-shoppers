-- Delivery zones: each zone has a fee, and a list of places (areas) belongs to it.
-- A zone marked courier has no fixed fee: the shop quotes the courier charge on WhatsApp
-- and sets it on the order afterwards.
CREATE TABLE IF NOT EXISTS delivery_zones (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(60) NOT NULL,
  fee         DECIMAL(10,2) NOT NULL DEFAULT 0,
  free_over   DECIMAL(10,2) NULL,
  eta_label   VARCHAR(40) NULL,
  courier     TINYINT(1) NOT NULL DEFAULT 0,
  sort_order  INT NOT NULL DEFAULT 0,
  active      TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS delivery_areas (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  zone_id   INT NOT NULL,
  name      VARCHAR(80) NOT NULL,
  county    VARCHAR(40) NOT NULL,
  active    TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_area (name, county),
  KEY idx_area_zone (zone_id),
  CONSTRAINT fk_area_zone FOREIGN KEY (zone_id) REFERENCES delivery_zones(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE orders
  ADD COLUMN area VARCHAR(80) NULL AFTER county,
  ADD COLUMN zone_name VARCHAR(60) NULL AFTER area,
  ADD COLUMN delivery_pending TINYINT(1) NOT NULL DEFAULT 0 AFTER delivery_fee;

-- Starting prices (KES) — change them any time in Admin > Delivery.
INSERT INTO delivery_zones (id, name, fee, free_over, eta_label, courier, sort_order) VALUES
 (1, 'Zone 1 · Nairobi central',              200, NULL, 'Same or next day', 0, 1),
 (2, 'Zone 2 · Nairobi estates',              300, NULL, '1–2 days',         0, 2),
 (3, 'Zone 3 · Nairobi outskirts',            400, 5000, '1–2 days',         0, 3),
 (4, 'Zone 4 · Thika to Kitengela',           600, 8000, '1–3 days',         0, 4),
 (5, 'Zone 5 · Upcountry (courier)',            0, NULL, '2–5 days',         1, 5);

INSERT INTO delivery_areas (zone_id, name, county) VALUES
 (1,'Nairobi CBD','Nairobi'),(1,'Upper Hill','Nairobi'),(1,'Westlands','Nairobi'),(1,'Parklands','Nairobi'),
 (1,'Kilimani','Nairobi'),(1,'Kileleshwa','Nairobi'),(1,'Lavington','Nairobi'),(1,'Hurlingham','Nairobi'),
 (1,'Ngara','Nairobi'),(1,'Pangani','Nairobi'),(1,'Eastleigh','Nairobi'),(1,'South B','Nairobi'),
 (1,'South C','Nairobi'),(1,'Nairobi West','Nairobi'),(1,'Madaraka','Nairobi'),(1,'Highridge','Nairobi'),
 (1,'Muthaiga','Nairobi'),(1,'Kariokor','Nairobi'),
 (2,'Kasarani','Nairobi'),(2,'Roysambu','Nairobi'),(2,'Zimmerman','Nairobi'),(2,'Githurai 44','Nairobi'),
 (2,'Githurai 45','Nairobi'),(2,'Kahawa West','Nairobi'),(2,'Kahawa Sukari','Nairobi'),(2,'Ruaraka','Nairobi'),
 (2,'Thome','Nairobi'),(2,'Lucky Summer','Nairobi'),(2,'Mathare','Nairobi'),(2,'Huruma','Nairobi'),
 (2,'Donholm','Nairobi'),(2,'Umoja','Nairobi'),(2,'Buruburu','Nairobi'),(2,'Jericho','Nairobi'),
 (2,'Makadara','Nairobi'),(2,'Kayole','Nairobi'),(2,'Komarock','Nairobi'),(2,'Embakasi','Nairobi'),
 (2,'Pipeline','Nairobi'),(2,'Fedha','Nairobi'),(2,'Utawala','Nairobi'),(2,'Langata','Nairobi'),
 (2,'Karen','Nairobi'),(2,'Dagoretti','Nairobi'),(2,'Kawangware','Nairobi'),(2,'Kangemi','Nairobi'),
 (2,'Riruta','Nairobi'),(2,'Uthiru','Nairobi'),(2,'Kinoo','Kiambu'),
 (3,'Ruiru','Kiambu'),(3,'Juja','Kiambu'),(3,'Kiambu Road','Kiambu'),(3,'Ruaka','Kiambu'),(3,'Kikuyu','Kiambu'),
 (3,'Karuri','Kiambu'),(3,'Banana','Kiambu'),(3,'Githurai Kimbo','Kiambu'),(3,'Kamulu','Nairobi'),(3,'Joska','Machakos'),
 (3,'Ruai','Nairobi'),(3,'Njiru','Nairobi'),(3,'Syokimau','Machakos'),(3,'Mlolongo','Machakos'),
 (3,'Ongata Rongai','Kajiado'),(3,'Ngong','Kajiado'),(3,'Kiserian','Kajiado'),(3,'Gataka','Kajiado'),
 (4,'Thika Town','Kiambu'),(4,'Makongeni (Thika)','Kiambu'),(4,'Kenyatta Road (Thika)','Kiambu'),
 (4,'Kitengela','Kajiado'),(4,'Athi River','Machakos'),(4,'Kiambu Town','Kiambu'),(4,'Limuru','Kiambu'),
 (4,'Tigoni','Kiambu'),(4,'Matuu Road','Machakos'),(4,'Isinya','Kajiado'),(4,'Kangundo Road','Nairobi');

-- Reux migration: Add currency codes
-- Kind: schema diff
-- Module: pilot
-- Safe: 3, unsafe: 0, destructive: 0

ALTER TABLE products ADD COLUMN currency char(3) NOT NULL DEFAULT 'USD' CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE orders ADD COLUMN currency char(3) NOT NULL DEFAULT 'USD' CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE payments ADD COLUMN currency char(3) NOT NULL DEFAULT 'USD' CHECK ("currency" ~ '^[A-Z]{3}$');

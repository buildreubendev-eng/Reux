-- DL migration: commerce_v2
-- Kind: schema diff
-- Module: commerce
-- Safe: 4, unsafe: 0, destructive: 0

ALTER TYPE order_status ADD VALUE 'Refunded';
ALTER TABLE users ADD COLUMN display_name text NULL;
CREATE INDEX users_by_email ON users (email ASC);
ALTER TABLE orders ADD COLUMN placed_at timestamptz NOT NULL DEFAULT now();

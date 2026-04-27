-- Reux migration: pilot initial schema
-- Kind: initial schema
-- Module: pilot

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE order_status AS ENUM ('Pending', 'Paid', 'Cancelled', 'Refunded');

CREATE TYPE payment_status AS ENUM ('Authorized', 'Captured', 'Failed', 'Refunded');

CREATE TABLE accounts (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NULL,
  balance numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  price numeric NOT NULL CHECK (price >= 0)
);

CREATE TABLE orders (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  total numeric NOT NULL CHECK (total >= 0),
  status order_status NOT NULL DEFAULT 'Pending',
  placed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE payments (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  status payment_status NOT NULL DEFAULT 'Authorized',
  captured_at timestamptz NULL,
  CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX accounts_by_email ON accounts (email ASC);

CREATE INDEX orders_by_account ON orders (account_id ASC);

CREATE INDEX payments_by_order ON payments (order_id ASC);

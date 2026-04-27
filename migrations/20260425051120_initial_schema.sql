-- DL migration: initial_schema
-- Kind: initial schema
-- Module: commerce

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE order_status AS ENUM ('Pending', 'Paid', 'Cancelled');

CREATE TABLE users (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NULL UNIQUE,
  balance numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  total numeric NOT NULL CHECK (total >= 0),
  status order_status NOT NULL DEFAULT 'Pending',
  CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX users_by_balance ON users (balance DESC);

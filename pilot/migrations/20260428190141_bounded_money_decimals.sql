-- Reux migration: Bounded money decimals
-- Kind: schema diff
-- Module: pilot
-- Safe: 0, unsafe: 4, destructive: 0

-- UNSAFE: alter field Account.balance; type/nullability/constraint changes need a reviewed migration
-- UNSAFE: alter field Product.price; type/nullability/constraint changes need a reviewed migration
-- UNSAFE: alter field Order.total; type/nullability/constraint changes need a reviewed migration
-- UNSAFE: alter field Payment.amount; type/nullability/constraint changes need a reviewed migration

ALTER TABLE accounts ALTER COLUMN balance TYPE numeric(12, 2) USING balance::numeric(12, 2);
ALTER TABLE products ALTER COLUMN price TYPE numeric(12, 2) USING price::numeric(12, 2);
ALTER TABLE orders ALTER COLUMN total TYPE numeric(12, 2) USING total::numeric(12, 2);
ALTER TABLE payments ALTER COLUMN amount TYPE numeric(12, 2) USING amount::numeric(12, 2);

/*
# Add persistent invoice review status

1. Changes
- Adds `needs_review` to `public.invoice_items`.
- Stores whether a vendor has marked a line item for follow-up.
- Existing items default to false so previously saved invoices remain usable.

2. Data safety
- This is a nullable-safe boolean addition with a default value.
- No existing rows, columns, or relationships are removed or changed.

3. Security
- Existing row-level security and CRUD policies remain unchanged.
- The existing shared no-login workspace can read and update this field.

4. Important notes
- Low extraction confidence still starts a row as flagged.
- Vendors can explicitly clear or reapply the review flag from the invoice tables.
*/

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

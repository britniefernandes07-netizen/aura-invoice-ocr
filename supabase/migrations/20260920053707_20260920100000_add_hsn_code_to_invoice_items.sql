/*
# Add HSN code to invoice items

1. Changes
- Adds `hsn_code` to `public.invoice_items` so the editable invoice review table can save HSN/SAC values alongside each product.
- Existing invoice items remain unchanged and receive an empty value.

2. Data safety
- This is a nullable addition and does not remove, rename, or change any existing data.

3. Security
- Existing row-level security and CRUD policies remain in place.

4. Important notes
- The column is nullable because some invoices do not show an HSN/SAC code.
*/

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS hsn_code text;

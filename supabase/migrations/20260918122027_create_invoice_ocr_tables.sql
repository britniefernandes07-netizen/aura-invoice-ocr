/*
# Create invoice OCR tables

1. New tables
- `invoices`: stores confirmed invoice header information and scan metadata.
- `invoice_items`: stores the editable product rows confirmed by the user.

2. Invoice columns
- `id`: unique invoice identifier.
- `supplier`: supplier name entered or read from the invoice.
- `bill_number`: optional supplier bill number.
- `total_amount`: confirmed total of the saved line items.
- `status`: current saved status.
- `source_filename`: original uploaded filename for reference.
- `created_at`: creation timestamp.

3. Invoice item columns
- `id`: unique line item identifier.
- `invoice_id`: parent invoice reference.
- `item_name`: product or service description.
- `quantity`: confirmed quantity.
- `rate`: confirmed unit price.
- `amount`: confirmed line total.
- `confidence`: scan confidence shown to the reviewer.
- `created_at`: creation timestamp.

4. Security
- Row level security is enabled on both tables.
- This is a single-tenant demo without a sign-in screen, so anon and authenticated users can manage the shared invoice workspace.
- Four separate CRUD policies are defined for each table.

5. Important notes
- The browser only writes rows after the user confirms the extracted details.
- The scan provider secret is not stored in these tables or sent to the browser.
*/

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier text NOT NULL DEFAULT 'Unknown supplier',
  bill_number text NOT NULL DEFAULT '',
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'saved',
  source_filename text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  quantity numeric(12,3),
  rate numeric(12,2),
  amount numeric(12,2),
  confidence numeric(4,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_items_invoice_id_idx ON public.invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS invoices_created_at_idx ON public.invoices(created_at DESC);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shared_select_invoices" ON public.invoices;
CREATE POLICY "shared_select_invoices" ON public.invoices FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shared_insert_invoices" ON public.invoices;
CREATE POLICY "shared_insert_invoices" ON public.invoices FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "shared_update_invoices" ON public.invoices;
CREATE POLICY "shared_update_invoices" ON public.invoices FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "shared_delete_invoices" ON public.invoices;
CREATE POLICY "shared_delete_invoices" ON public.invoices FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "shared_select_invoice_items" ON public.invoice_items;
CREATE POLICY "shared_select_invoice_items" ON public.invoice_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shared_insert_invoice_items" ON public.invoice_items;
CREATE POLICY "shared_insert_invoice_items" ON public.invoice_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "shared_update_invoice_items" ON public.invoice_items;
CREATE POLICY "shared_update_invoice_items" ON public.invoice_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "shared_delete_invoice_items" ON public.invoice_items;
CREATE POLICY "shared_delete_invoice_items" ON public.invoice_items FOR DELETE TO anon, authenticated USING (true);

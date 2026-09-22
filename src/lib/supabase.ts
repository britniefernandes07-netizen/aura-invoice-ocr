import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface InvoiceItem {
  id?: string;
  item_name: string;
  hsn_code: string | null;   // <-- add this line
  quantity: number | null;
  rate: number | null;
  amount: number | null;
  confidence: number;
  needs_review?: boolean;
}

export interface Invoice {
  id: string;
  supplier: string;
  bill_number: string;
  total_amount: number;
  status: string;
  source_filename: string;
  created_at: string;
  invoice_items?: InvoiceItem[];
}

export interface ScanResult {
  line_items: InvoiceItem[];
  supplier: string | null;
  bill_number: string | null;
  total_items: number;
  items_needing_review: number;
  debug_raw_ocr_text?: string;
  debug_groq_raw?: string;
  error?: string;
}

export async function extractLineItems(ocrText: string): Promise<ScanResult> {
  const functionUrl = `${supabaseUrl}/functions/v1/parse-invoice`;
  const resp = await fetch(functionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({ ocr_text: ocrText }),
  });

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    const stage = errData?.debug_stage ? ` (${errData.debug_stage})` : "";
    throw new Error(errData?.error ? `${errData.error}${stage}` : `Server returned ${resp.status}`);
  }

  const data = await resp.json();
  if (data && data.error) {
    throw new Error(data.error);
  }
  return data;
}

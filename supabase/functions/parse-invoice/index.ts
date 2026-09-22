const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-120b";
const CONFIDENCE_THRESHOLD = 0.75;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const groqApiKey = Deno.env.get("GROQ_API_KEY");
    if (!groqApiKey) {
      return jsonResponse({ error: "OCR provider key not configured." }, 503);
    }

    const body = await req.json();
    const ocrText: string = body?.ocr_text;
    if (!ocrText || typeof ocrText !== "string" || ocrText.trim().length === 0) {
      return jsonResponse({ error: "No OCR text was provided." }, 400);
    }

    let extraction;
    try {
      extraction = await runGroqExtraction(groqApiKey, ocrText);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("Groq extraction failed", detail);
      return jsonResponse({
        error: `Could not extract line items from the invoice text. ${detail}`,
        debug_raw_ocr_text: ocrText,
        debug_stage: "extraction",
      }, 502);
    }

    return jsonResponse({
      line_items: extraction.line_items,
      supplier: extraction.supplier,
      bill_number: extraction.bill_number,
      total_items: extraction.line_items.length,
      items_needing_review: extraction.line_items.filter((i: any) => i.needs_review).length,
      debug_raw_ocr_text: ocrText,
      debug_groq_raw: extraction.debug_raw,
    });
  } catch (err) {
    console.error("parse-invoice error", err);
    return jsonResponse({ error: "Something went wrong while extracting invoice data.", debug_stage: "request" }, 500);
  }
});

async function runGroqExtraction(apiKey: string, ocrText: string) {
  const systemPrompt = `You are an invoice data extraction assistant. You will be given raw, possibly messy OCR text from a scanned invoice or bill.

Your job: find every individual product or service line item listed on the invoice and return them as a JSON array.

Look for lines that contain a product name, an HSN/SAC code, a quantity, a unit price/rate, and/or a line total amount. These are typically in a table-like section of the invoice. Even if the OCR is messy or misaligned, do your best to identify product lines.

Some invoices have TWO quantity columns (e.g. "Alt. Quantity" in one unit like Kgs, and "Quantity" in another unit like Bags/pieces). When this happens, pick the quantity whose unit matches the rate's unit, so that quantity x rate = amount. For example if rate is "55.00 per Kg", use the Kg-based quantity, not the Bags/pieces count, even if the Bags/pieces number appears closer to the item name.

Do NOT include: headers, tax lines, subtotal/total lines, discount lines, shipping lines, or payment info — only actual product/service line items.

IMPORTANT — Supplier and Bill Number extraction:
- The supplier/vendor name is usually at the TOP of the invoice, often in a header or logo area. It may be a company name, a shop name, or a person's name. Look for text near the top of the OCR output, before the item table begins. Common patterns: "M/s <name>", a company name in large/bold text, or a label like "Supplier:", "Vendor:", "From:", "Billed by".
- The bill/invoice number usually appears near the top as well, often labeled "Bill No", "Invoice No", "Bill #", "Inv No", "Invoice Number", "Bill Number", or just a number near the date. It may contain letters and digits (e.g. "INV-2024-001", "BLR/123/24"). Extract the full identifier including any prefix/suffix.
- If the supplier or bill number is not clearly visible, return null — do NOT guess or invent values.
- If the OCR is messy, look for partial matches and reconstruct the most likely value.
- Scan the ENTIRE OCR text if not found near the top — sometimes they appear in a footer or stamp area.

You MUST respond with ONLY a JSON object in this exact format (no markdown, no explanation, no code fences):
{
  "supplier": "string or null",
  "bill_number": "string or null",
  "line_items": [
    {
      "item_name": "the product or service name",
      "hsn_code": "the HSN or SAC code for this item, or null if not found",
      "quantity": number or null,
      "rate": number or null,
      "amount": number or null,
      "confidence": 0.0 to 1.0
    }
  ]
}

Rules:
- Always include the "line_items" array, even if it has only one item.
- If you cannot find any line items, return an empty array: "line_items": []
- Use null for any field you cannot determine, including hsn_code.
- Set confidence to your estimate of how accurate the extraction is for that line (0 to 1).`;

  const body = {
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Extract all line items from this invoice OCR text:\n\n${ocrText}` },
    ],
    temperature: 0.1,
    max_tokens: 8000,
  };

  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Groq extraction ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  const rawContent = data?.choices?.[0]?.message?.content ?? "{}";
  if (typeof rawContent !== "string") {
    throw new Error("Groq returned no text content");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    const cleaned = rawContent
      .replace(/\s*```(?:json)?\s*/gi, "")
      .replace(/```/g, "")
      .trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not parse JSON from Groq response");
      parsed = JSON.parse(jsonMatch[0]);
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Groq returned an invalid extraction object");
  }

  const items: any[] = Array.isArray(parsed.line_items) ? parsed.line_items : [];

  const line_items = items.map((entry: any) => {
    const confidence = clampConfidence(entry.confidence ?? 0.5);
    return {
      item_name: entry.item_name ?? "",
      hsn_code: entry.hsn_code ?? null,
      quantity: entry.quantity ?? null,
      rate: entry.rate ?? null,
      amount: entry.amount ?? null,
      confidence,
      needs_review: confidence < CONFIDENCE_THRESHOLD,
    };
  });

  return {
    supplier: parsed?.supplier ?? null,
    bill_number: parsed?.bill_number ?? null,
    line_items,
    debug_raw: rawContent,
  };
}

function clampConfidence(c: number): number {
  const n = Math.max(0, Math.min(1, Number(c) || 0));
  return Math.round(n * 1000) / 1000;
}
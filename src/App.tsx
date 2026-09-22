import { useState, useCallback, useEffect } from "react";
import { Upload, FileText, CheckCircle2, AlertTriangle, Loader2, Scan, Save, RotateCcw, X, History, Trash2, ArrowLeft, Search, Download } from "lucide-react";
import "./App.css";
import { supabase, extractLineItems, type InvoiceItem, type Invoice, type ScanResult } from "./lib/supabase";
import { runOcr } from "./lib/ocr";

type View = "scan" | "review" | "history";

export default function App() {
  const [view, setView] = useState<View>("scan");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanStage, setScanStage] = useState<string>("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [lineItems, setLineItems] = useState<InvoiceItem[]>([]);
  const [supplier, setSupplier] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [history, setHistory] = useState<Invoice[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(null);
  const [historySaveMessage, setHistorySaveMessage] = useState<string | null>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setScanError(null);
    if (f && f.type.startsWith("image/")) {
      setPreviewUrl(URL.createObjectURL(f));
    } else if (f) {
      setPreviewUrl(null);
    } else {
      setPreviewUrl(null);
    }
  };

  const scanInvoice = useCallback(async () => {
    if (!file) return;
    setScanning(true);
    setScanError(null);
    setScanResult(null);

    try {
      setScanStage("Reading text from image...");
      const ocrResult = await runOcr(file, () => {});

      if (!ocrResult.text.trim()) {
        throw new Error("No readable text was found in the image. Try a clearer photo.");
      }

      setScanStage("Extracting line items...");
      const data: ScanResult = await extractLineItems(ocrResult.text);
      if (data.error) throw new Error(data.error);

      // Always go to review, even with 0 items, so the debug sections
      // (raw OCR text, raw Groq response) are visible instead of hidden.
      setScanResult(data);
      setLineItems(data.line_items || []);
      setSupplier(data.supplier || "");
      setBillNumber(data.bill_number || "");
      setView("review");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "The invoice image could not be processed.";
      setScanError(message);
    } finally {
      setScanning(false);
      setScanStage("");
    }
  }, [file]);

  const updateItem = (index: number, field: keyof InvoiceItem, value: string) => {
    setLineItems((prev) => {
      const next = [...prev];
      const item = { ...next[index] };
      if (field === "item_name" || field === "hsn_code") {
        (item as any)[field] = value;
      } else {
        const num = value === "" ? null : parseFloat(value);
        (item as any)[field] = isNaN(num as number) ? null : num;
      }
      next[index] = item;
      return next;
    });
  };

  const removeItem = (index: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleReview = (index: number) => {
    setLineItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], needs_review: !next[index].needs_review };
      return next;
    });
  };

  const addItem = () => {
    setLineItems((prev) => [
      ...prev,
      { item_name: "", hsn_code: null, quantity: null, rate: null, amount: null, confidence: 0, needs_review: true },
    ]);
  };

  const totalAmount = lineItems.reduce((sum, i) => sum + (parseFloat(String(i.amount)) || 0), 0);

  const saveInvoice = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const { data: invoiceData, error: invoiceError } = await supabase
        .from("invoices")
        .insert([
          {
            supplier: supplier || "Unknown Supplier",
            bill_number: billNumber || "",
            total_amount: totalAmount,
            status: "saved",
            source_filename: file?.name || "",
          },
        ])
        .select()
        .maybeSingle();

      if (invoiceError) throw invoiceError;
      if (!invoiceData) throw new Error("The invoice could not be created.");
      const invoiceId = invoiceData.id;

      const itemsToInsert = lineItems.map((item) => ({
        invoice_id: invoiceId,
        item_name: item.item_name,
        hsn_code: item.hsn_code,
        quantity: item.quantity,
        rate: item.rate,
        amount: item.amount,
        confidence: item.confidence,
        needs_review: item.needs_review ?? false,
      }));

      const { error: itemsError } = await supabase.from("invoice_items").insert(itemsToInsert);
      if (itemsError) throw itemsError;

      setSaveMessage({ type: "ok", text: "Saved to the database successfully." });
      await loadHistory();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Please try again.";
      setSaveMessage({ type: "err", text: `Could not save the invoice. ${message}` });
      console.error("Save failed", err);
    } finally {
      setSaving(false);
    }
  };

  const resetAll = () => {
    setFile(null);
    setPreviewUrl(null);
    setScanResult(null);
    setLineItems([]);
    setSupplier("");
    setBillNumber("");
    setScanError(null);
    setSaveMessage(null);
    setView("scan");
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, invoice_items(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setHistory((data as any[]) || []);
    } catch (err) {
      console.error("Failed to load history", err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const updateHistoryItem = (invoiceId: string, itemId: string | undefined, field: keyof InvoiceItem, value: string) => {
    setHistory((prev) => prev.map((invoice) => {
      if (invoice.id !== invoiceId) return invoice;
      return {
        ...invoice,
        invoice_items: invoice.invoice_items?.map((item) => {
          if (item.id !== itemId) return item;
          if (field === "item_name" || field === "hsn_code") return { ...item, [field]: value };
          const numericValue = value === "" ? null : parseFloat(value);
          return { ...item, [field]: Number.isNaN(numericValue) ? null : numericValue };
        }),
      };
    }));
  };

  const saveHistoryInvoice = async (invoice: Invoice) => {
    setHistorySaveMessage(null);
    try {
      const { error: invoiceError } = await supabase
        .from("invoices")
        .update({ total_amount: (invoice.invoice_items || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0) })
        .eq("id", invoice.id);
      if (invoiceError) throw invoiceError;

      for (const item of invoice.invoice_items || []) {
        if (!item.id) continue;
        const { error } = await supabase.from("invoice_items").update({
          item_name: item.item_name,
          hsn_code: item.hsn_code || null,
          quantity: item.quantity,
          rate: item.rate,
          amount: item.amount,
          needs_review: item.needs_review ?? false,
        }).eq("id", item.id);
        if (error) throw error;
      }

      setHistorySaveMessage("Changes saved successfully.");
      await loadHistory();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Please try again.";
      setHistorySaveMessage(`Could not save changes. ${message}`);
    }
  };

  const toggleHistoryReview = (invoiceId: string, itemId: string | undefined) => {
    setHistory((prev) => prev.map((invoice) => {
      if (invoice.id !== invoiceId) return invoice;
      return {
        ...invoice,
        invoice_items: invoice.invoice_items?.map((item) =>
          item.id === itemId ? { ...item, needs_review: !item.needs_review } : item
        ),
      };
    }));
  };

  const deleteInvoice = async (id: string) => {
    try {
      const { error } = await supabase.from("invoices").delete().eq("id", id);
      if (error) throw error;
      setHistory((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  const openHistory = async () => {
    setView("history");
    await loadHistory();
  };

  const exportHistory = () => {
    const rows = history.flatMap((invoice) => (invoice.invoice_items || []).map((item) => ({
      supplier: invoice.supplier,
      bill_number: invoice.bill_number,
      date: new Date(invoice.created_at).toLocaleDateString(),
      item: item.item_name,
      hsn: item.hsn_code || "",
      quantity: item.quantity ?? "",
      rate: item.rate ?? "",
      amount: item.amount ?? "",
      review: item.needs_review ? "Flagged" : "Clear",
    })));
    const headers = Object.keys(rows[0] || { supplier: "", bill_number: "", date: "", item: "", hsn: "", quantity: "", rate: "", amount: "", review: "" });
    const csv = [headers, ...rows.map((row) => headers.map((header) => `"${String(row[header as keyof typeof row]).replace(/"/g, '""')}"`))]
      .map((row) => row.join(","))
      .join("\\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "aura-invoice-history.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <div className="logo-icon">
              <Scan size={22} />
            </div>
            <div>
              <h1>AURA</h1>
              <span className="logo-sub">Invoice OCR</span>
            </div>
          </div>
          <nav className="nav">
            <button className={`nav-btn ${view === "scan" || view === "review" ? "active" : ""}`} onClick={resetAll}>
              <Scan size={16} /> Scan
            </button>
            <button className={`nav-btn ${view === "history" ? "active" : ""}`} onClick={openHistory}>
              <History size={16} /> History
            </button>
          </nav>
        </div>
      </header>

      <main className="main">
        {view === "scan" && (
          <ScanView
            file={file}
            previewUrl={previewUrl}
            scanning={scanning}
            scanStage={scanStage}
            scanError={scanError}
            history={history}
            onFileChange={onFileChange}
            onScan={scanInvoice}
            onHistory={openHistory}
          />
        )}

        {view === "review" && scanResult && (
          <ReviewView
            lineItems={lineItems}
            supplier={supplier}
            billNumber={billNumber}
            totalAmount={totalAmount}
            scanResult={scanResult}
            saving={saving}
            saveMessage={saveMessage}
            previewUrl={previewUrl}
            onSupplier={setSupplier}
            onBillNumber={setBillNumber}
            onUpdateItem={updateItem}
            onToggleReview={toggleReview}
            onRemoveItem={removeItem}
            onAddItem={addItem}
            onSave={saveInvoice}
            onRescan={resetAll}
          />
        )}

        {view === "history" && (
          <HistoryView
            history={history}
            loading={loadingHistory}
            expandedInvoice={expandedInvoice}
            onToggleExpand={setExpandedInvoice}
            onDelete={deleteInvoice}
            onUpdateItem={updateHistoryItem}
            onToggleReview={toggleHistoryReview}
            onSaveInvoice={saveHistoryInvoice}
            historySaveMessage={historySaveMessage}
            onExport={exportHistory}
            onBack={() => setView("scan")}
          />
        )}
      </main>
    </div>
  );
}

function ScanView({ file, previewUrl, scanning, scanStage, scanError, history, onFileChange, onScan, onHistory }: any) {
  const today = new Date().toDateString();
  const scannedToday = history.filter((invoice: Invoice) => new Date(invoice.created_at).toDateString() === today).length;
  const flaggedItems = history.reduce((count: number, invoice: Invoice) => count + (invoice.invoice_items || []).filter((item) => item.needs_review).length, 0);
  const confidenceItems = history.flatMap((invoice: Invoice) => invoice.invoice_items || []);
  const averageConfidence = confidenceItems.length
    ? Math.round((confidenceItems.reduce((sum, item) => sum + (item.confidence || 0), 0) / confidenceItems.length) * 100)
    : 0;

  return (
    <div className="scan-view">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Invoices</span>
          <h2>Scan a new invoice</h2>
          <p className="muted">Upload the supplier bill, check the details it reads, then save it.</p>
        </div>
        <button className="btn btn-ghost" onClick={onHistory}>
          <History size={16} /> View saved invoices
        </button>
      </div>
      <div className="stats-grid">
        <div className="stat-card"><span>Scanned today</span><strong>{scannedToday}</strong><FileText size={20} /></div>
        <div className="stat-card stat-card-success"><span>Saved successfully</span><strong>{history.length}</strong><CheckCircle2 size={20} /></div>
        <div className="stat-card stat-card-warning"><span>Flagged for review</span><strong>{flaggedItems}</strong><AlertTriangle size={20} /></div>
        <div className="stat-card stat-card-confidence"><span>Avg. confidence</span><strong>{averageConfidence}%</strong><CheckCircle2 size={20} /></div>
      </div>
      <div className="card upload-card">
        <h2>Upload Invoice</h2>
        <p className="muted">Upload a clear photo of your invoice. AURA will read it and extract the product line items automatically.</p>

        <label className="dropzone">
          <input type="file" accept=".png,.jpg,.jpeg,.webp" onChange={onFileChange} />
          <div className="dropzone-content">
            {previewUrl ? (
              <img src={previewUrl} alt="Preview" className="preview-img" />
            ) : file ? (
              <div className="file-info">
                <FileText size={40} />
                <span>{file.name}</span>
              </div>
            ) : (
              <>
                <Upload size={40} />
                <span className="dropzone-title">Drop or click to upload</span>
                <span className="muted">PNG, JPG, or WEBP — up to 8 MB</span>
              </>
            )}
          </div>
        </label>

        {scanError && (
          <div className="alert alert-error">
            <AlertTriangle size={18} />
            <span>{scanError}</span>
          </div>
        )}

        <button className="btn btn-primary btn-lg" disabled={!file || scanning} onClick={onScan}>
          {scanning ? (
            <>
              <Loader2 size={18} className="spin" /> {scanStage || "Scanning invoice..."}
            </>
          ) : (
            <>
              <Scan size={18} /> Scan Product Fields
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function ReviewView({
  lineItems, supplier, billNumber, totalAmount, scanResult, saving, saveMessage, previewUrl,
  onSupplier, onBillNumber, onUpdateItem, onToggleReview, onRemoveItem, onAddItem, onSave, onRescan,
}: any) {
  const needsReview = lineItems.filter((i: InvoiceItem) => i.needs_review).length;

  return (
    <div className="review-view">
      <div className="review-grid">
        {previewUrl && (
          <div className="card preview-card">
            <h3>Invoice Preview</h3>
            <img src={previewUrl} alt="Invoice" className="preview-large" />
          </div>
        )}

        <div className="card review-card">
          <div className="review-header">
            <div>
              <span className="eyebrow">Review workspace</span>
              <h2>Confirm Line Items</h2>
              <p className="muted">Rows in amber were low-confidence reads. Fix, add, remove, or flag any row before saving.</p>
            </div>
            <div className="review-summary">
              <div className="confidence-ring">
                <strong>{Math.round((lineItems.length ? lineItems.reduce((sum: number, item: InvoiceItem) => sum + (item.confidence || 0), 0) / lineItems.length : 0) * 100)}%</strong>
              </div>
              <div className="summary-label"><span>Avg.</span><span>confidence</span></div>
              <span className="stat-pill">{lineItems.length} items</span>
              {needsReview > 0 && (
                <span className="stat-pill stat-warning">
                  <AlertTriangle size={13} /> {needsReview} need review
                </span>
              )}
            </div>
          </div>

          <div className="meta-row">
            <label className="meta-field">
              <span className="meta-label">Supplier</span>
              <input value={supplier} onChange={(e) => onSupplier(e.target.value)} placeholder="Supplier name" />
            </label>
            <label className="meta-field">
              <span className="meta-label">Bill No.</span>
              <input value={billNumber} onChange={(e) => onBillNumber(e.target.value)} placeholder="Bill number" />
            </label>
          </div>

          {lineItems.length === 0 && (
            <div className="alert alert-error">
              <AlertTriangle size={18} />
              <span>No line items were extracted. Check the debug sections below to see what went wrong.</span>
            </div>
          )}

          <div className="table-wrap">
            <table className="items-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="col-narrow">HSN</th>
                  <th className="col-narrow">Qty</th>
                  <th className="col-narrow">Rate</th>
                  <th className="col-narrow">Amount</th>
                  <th>Confidence</th>
                  <th className="col-icon"></th>
                  <th className="col-icon"></th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item: InvoiceItem, i: number) => (
                  <tr key={i} className={item.needs_review ? "row-flagged" : ""}>
                    <td>
                      <input
                        className="cell"
                        value={item.item_name || ""}
                        placeholder="Item name"
                        onChange={(e) => onUpdateItem(i, "item_name", e.target.value)}
                      />
                    </td>
                    <td className="col-narrow">
                      <input className="cell" placeholder="HSN" value={item.hsn_code ?? ""} onChange={(e) => onUpdateItem(i, "hsn_code", e.target.value)} />
                    </td>
                    <td className="col-narrow">
                      <input className="cell cell-num" placeholder="0" value={item.quantity ?? ""} onChange={(e) => onUpdateItem(i, "quantity", e.target.value)} />
                    </td>
                    <td className="col-narrow">
                      <input className="cell cell-num" placeholder="0.00" value={item.rate ?? ""} onChange={(e) => onUpdateItem(i, "rate", e.target.value)} />
                    </td>
                    <td className="col-narrow">
                      <input className="cell cell-num" placeholder="0.00" value={item.amount ?? ""} onChange={(e) => onUpdateItem(i, "amount", e.target.value)} />
                    </td>
                    <td className="confidence-cell">
                      <span className={`confidence-badge ${item.needs_review ? "confidence-badge-warning" : "confidence-badge-ok"}`}>
                        <span className="confidence-dot" /> {Math.round((item.confidence || 0) * 100)}%
                      </span>
                    </td>
                    <td className="col-icon">
                      <button className={`flag-btn ${item.needs_review ? "flag-btn-active" : ""}`} onClick={() => onToggleReview(i)} title={item.needs_review ? "Clear review flag" : "Flag for review"}>
                        {item.needs_review ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                      </button>
                    </td>
                    <td className="col-icon">
                      <button className="icon-btn" onClick={() => onRemoveItem(i)} title="Remove">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="btn btn-ghost btn-sm" onClick={onAddItem}>
            + Add row
          </button>

          <div className="total-row">
            <span>Total</span>
            <span className="total-amount">₹{totalAmount.toFixed(2)}</span>
          </div>

          {saveMessage && saveMessage.type === "ok" && (
            <div className="save-success-banner">
              <CheckCircle2 size={22} />
              <div>
                <strong>{saveMessage.text}</strong>
                <span className="muted small">The invoice and its line items are now in your saved history.</span>
              </div>
              <button className="btn btn-primary" onClick={onRescan}><Scan size={16} /> Scan another</button>
            </div>
          )}

          {saveMessage && saveMessage.type === "err" && (
            <div className={`alert alert-error`}>
              <AlertTriangle size={18} />
              <span>{saveMessage.text}</span>
            </div>
          )}

          {(!saveMessage || saveMessage.type !== "ok") && (
            <div className="actions">
              <button className="btn btn-primary btn-lg" disabled={saving || lineItems.length === 0} onClick={onSave}>
                {saving ? (
                  <><Loader2 size={18} className="spin" /> Saving...</>
                ) : (
                  <><Save size={18} /> Confirm & Save</>
                )}
              </button>
              <button className="btn btn-ghost" onClick={onRescan}>
                <RotateCcw size={16} /> Re-scan
              </button>
            </div>
          )}

          {scanResult.debug_raw_ocr_text && (
            <details className="debug-section">
              <summary>Raw OCR text (for debugging)</summary>
              <pre className="debug-pre">{scanResult.debug_raw_ocr_text}</pre>
            </details>
          )}
          {(scanResult as any).debug_groq_raw && (
            <details className="debug-section">
              <summary>Raw Groq response (for debugging)</summary>
              <pre className="debug-pre">{(scanResult as any).debug_groq_raw}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryView({ history, loading, expandedInvoice, onToggleExpand, onDelete, onUpdateItem, onToggleReview, onSaveInvoice, historySaveMessage, onBack, onExport }: any) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "saved" | "flagged">("all");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredHistory = history.filter((invoice: Invoice) => {
    const matchesQuery = !normalizedQuery || invoice.supplier.toLowerCase().includes(normalizedQuery) || invoice.bill_number.toLowerCase().includes(normalizedQuery);
    const matchesFilter = filter === "all" || (filter === "flagged" ? (invoice.invoice_items || []).some((item) => item.needs_review) : true);
    return matchesQuery && matchesFilter;
  });

  return (
    <div className="history-view">
      <div className="history-header">
        <div>
          <span className="eyebrow">Archive</span>
          <h2>Saved Invoices</h2>
          <p className="muted">Everything you have scanned and confirmed so far.</p>
        </div>
        <button className="btn btn-ghost" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Scan
        </button>
      </div>

      {loading ? (
        <div className="loading-state">
          <Loader2 size={28} className="spin" />
          <span>Loading invoices...</span>
        </div>
      ) : history.length === 0 ? (
        <div className="empty-state">
          <FileText size={40} />
          <p>No saved invoices yet.</p>
          <span className="muted">Scan and save an invoice to see it here.</span>
        </div>
      ) : (
        <>
        {historySaveMessage && (
          <div className={`alert ${historySaveMessage.startsWith("Could not") ? "alert-error" : "alert-success"}`} style={{ marginBottom: 16 }}>
            {historySaveMessage.startsWith("Could not") ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            <span>{historySaveMessage}</span>
          </div>
        )}
        <div className="history-toolbar">
          <div className="search-box">
            <Search size={16} />
            <input type="text" placeholder="Search by supplier or bill number..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="filter-group">
            <button className={`filter-btn ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>All</button>
            <button className={`filter-btn ${filter === "saved" ? "active" : ""}`} onClick={() => setFilter("saved")}>Saved</button>
            <button className={`filter-btn ${filter === "flagged" ? "active" : ""}`} onClick={() => setFilter("flagged")}>Flagged</button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onExport} disabled={history.length === 0}>
            <Download size={15} /> Export CSV
          </button>
        </div>
        {filteredHistory.length === 0 ? (
          <div className="empty-state">
            <Search size={36} />
            <p>No invoices match your search.</p>
            <span className="muted">Try a different keyword or clear the filter.</span>
          </div>
        ) : (
        <div className="history-list">
          {filteredHistory.map((inv: Invoice) => (
            <div key={inv.id} className="card history-card">
              <div className="history-card-header" onClick={() => onToggleExpand(expandedInvoice === inv.id ? null : inv.id)}>
                <div className="history-card-info">
                  <h3>{inv.supplier}</h3>
                  <span className="muted small">
                    {inv.bill_number ? `Bill #${inv.bill_number} · ` : ""}
                    {new Date(inv.created_at).toLocaleDateString()} · ₹{Number(inv.total_amount).toFixed(2)}
                  </span>
                </div>
                <div className="history-card-actions">
                  {(inv.invoice_items || []).some((item) => item.needs_review) && <span className="stat-pill stat-warning"><AlertTriangle size={13} /> Review needed</span>}
                  <span className="stat-pill">{inv.invoice_items?.length || 0} items</span>
                  <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onDelete(inv.id); }} title="Delete">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {expandedInvoice === inv.id && (
                <div className="history-details">
                  {inv.invoice_items && inv.invoice_items.length > 0 ? (
                    <>
                      <div className="history-review-note"><AlertTriangle size={15} /> Review flagged rows, update the values, then save. Use the flag button to clear or re-apply a review flag.</div>
                      <div className="table-wrap history-table-wrap">
                        <table className="items-table history-table">
                          <thead>
                            <tr>
                              <th>Item</th>
                              <th className="col-narrow">HSN</th>
                              <th className="col-narrow">Qty</th>
                              <th className="col-narrow">Rate</th>
                              <th className="col-narrow">Amount</th>
                              <th>Confidence</th>
                              <th className="col-icon"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {inv.invoice_items.map((item: InvoiceItem) => (
                              <tr key={item.id} className={item.needs_review ? "row-flagged" : ""}>
                                <td><input className="cell" value={item.item_name || ""} onChange={(e) => onUpdateItem(inv.id, item.id, "item_name", e.target.value)} /></td>
                                <td className="col-narrow"><input className="cell" value={item.hsn_code ?? ""} onChange={(e) => onUpdateItem(inv.id, item.id, "hsn_code", e.target.value)} /></td>
                                <td className="col-narrow"><input className="cell cell-num" value={item.quantity ?? ""} onChange={(e) => onUpdateItem(inv.id, item.id, "quantity", e.target.value)} /></td>
                                <td className="col-narrow"><input className="cell cell-num" value={item.rate ?? ""} onChange={(e) => onUpdateItem(inv.id, item.id, "rate", e.target.value)} /></td>
                                <td className="col-narrow"><input className="cell cell-num" value={item.amount ?? ""} onChange={(e) => onUpdateItem(inv.id, item.id, "amount", e.target.value)} /></td>
                                <td className="col-icon">
                                  <button className={`flag-btn ${item.needs_review ? "flag-btn-active" : ""}`} onClick={() => onToggleReview(inv.id, item.id)} title={item.needs_review ? "Clear review flag" : "Flag for review"}>
                                    {item.needs_review ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button className="btn btn-primary btn-sm history-save" onClick={() => onSaveInvoice(inv)}><Save size={15} /> Save changes</button>
                    </>
                  ) : <p className="history-empty">No line items were saved for this invoice.</p>}
                </div>
              )}
            </div>
          ))}
        </div>
        )}
        </>
      )}
    </div>
  );
}
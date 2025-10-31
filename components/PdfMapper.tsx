"use client";

import { useEffect, useRef, useState } from "react";
// pdf.js is loaded dynamically on the client to avoid SSR build issues on Node 20

type MappingField =
  | { id: string; page: number; type?: "text" | "date_de" | "checkbox"; x: number | null; y: number | null; w?: number; align?: "left" | "right" }
  | { id: string; page: number; type: "boolean_pair"; x_true: number | null; y_true: number | null; x_false: number | null; y_false: number | null };

type Mapping = {
  template?: string;
  font?: string;
  size?: number;
  status?: string;
  fields: MappingField[];
};

export default function PdfMapper() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const pdfjsRef = useRef<any>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [page, setPage] = useState<any>(null);
  const [scale, setScale] = useState(1);
  const [fields, setFields] = useState<MappingField[]>([]);
  const [idx, setIdx] = useState(0);
  const [awaitingFalse, setAwaitingFalse] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [hoverXY, setHoverXY] = useState<{x:number;y:number}|null>(null);
  const [drag, setDrag] = useState<null | { kind: "text" | "bp_true" | "bp_false"; i: number }>(null);
  const [previewData, setPreviewData] = useState<Record<string, any>>({});
  const [showIds, setShowIds] = useState(true);
  const [showValues, setShowValues] = useState(true);
  const [placingMode, setPlacingMode] = useState(true); // nur setzen, wenn aktiv
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [snap, setSnap] = useState(5); // px
  const [resizeW, setResizeW] = useState<null | { i:number }>(null);
  const [overflowInfo, setOverflowInfo] = useState<null | { id:string; width:number; w:number }>(null);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);

  const current = fields[idx];
  const displayType = (f: any) => {
    const t = (f?.type || 'text') as string;
    if (t === 'boolean_pair') return 'Ja/Nein';
    if (t === 'date_de') return 'Datum';
    if (t === 'checkbox') return 'Auswahlfeld';
    return 'Text';
  };

  // Load pdf.js only in the browser
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (typeof window === 'undefined') return;
      const pdfjs = await import("pdfjs-dist");
      // worker from public/
      try { (pdfjs as any).GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"; } catch {}
      if (mounted) pdfjsRef.current = pdfjs;
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!pdfDoc) return;
    (async () => {
      const p = await pdfDoc.getPage(1);
      setPage(p);
      const unscaled = p.getViewport({ scale: 1 });
      const available = Math.min(window.innerWidth - 360 - 80, 1200);
      const fit = Math.max(0.5, Math.min(2.5, available / unscaled.width));
      setScale(fit);
      await renderPage(p, fit);
    })().catch((err) => {
      console.error("Render error", err);
    });
  }, [pdfDoc]);

  const renderPage = async (p: any, s: number) => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const viewport = p.getViewport({ scale: s });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const task = p.render({ canvasContext: ctx, viewport });
    await task.promise;
    // match overlay size
    if (overlayRef.current) {
      overlayRef.current.width = canvas.width;
      overlayRef.current.height = canvas.height;
    }
    drawOverlay();
  };

  const drawOverlay = () => {
    const ol = overlayRef.current;
    const base = canvasRef.current;
    if (!ol || !base) return;
    const octx = ol.getContext("2d")!;
    octx.clearRect(0,0,ol.width, ol.height);
    // optional grid
    if (showGrid) {
      octx.save();
      octx.globalAlpha = 0.15;
      octx.strokeStyle = '#6b7280';
      const step = 25;
      for (let x=0; x<ol.width; x+=step) { octx.beginPath(); octx.moveTo(x,0); octx.lineTo(x,ol.height); octx.stroke(); }
      for (let y=0; y<ol.height; y+=step) { octx.beginPath(); octx.moveTo(0,y); octx.lineTo(ol.width,y); octx.stroke(); }
      octx.restore();
    }
    // style
    octx.font = "12px ui-sans-serif, system-ui";
    octx.textBaseline = "top";
    const css = getComputedStyle(document.body);
    const colActive = css.getPropertyValue('--color-base-gold').trim() || '#ffc300';
    const colPlaced = css.getPropertyValue('--color-status-info').trim() || '#2563eb';
    const colTrue = css.getPropertyValue('--color-status-success').trim() || '#16a34a';
    const colFalse = css.getPropertyValue('--color-status-error').trim() || '#ef4444';
    // Align preview default with stamping default (10pt)
    const fontSizeGlobal = (mapping?.size as number) || 10;
    const sampleText = (f: any): string => {
      const v = (previewData as any)?.[f?.id];
      if (v !== undefined && v !== null && String(v) !== '') return String(v);
      if (f?.type === 'date_de' || /datum/i.test(f?.id || '')) return '01.01.2025';
      if (f?.align === 'right' || /betrag|wert|summe|eur|€/i.test(f?.id || '')) return '1.234,56 €';
      if (/name|aussteller|ort/i.test(f?.id || '')) return 'Max Mustermann';
      return 'Beispiel Text';
    };
    // draw each placed marker
    fields.forEach((f, i) => {
      if ((f as any).type === "boolean_pair") {
        const bp = f as any;
        if (bp.x_true != null && bp.y_true != null) {
          const cx = Math.round(bp.x_true);
          const cy = Math.round(ol.height - bp.y_true);
          drawDot(octx, cx, cy, i === idx ? colActive : colTrue);
          if (showIds) drawTag(octx, cx, cy, `${bp.id}: Ja`);
        }
        if (bp.x_false != null && bp.y_false != null) {
          const cx = Math.round(bp.x_false);
          const cy = Math.round(ol.height - bp.y_false);
          drawDot(octx, cx, cy, i === idx ? colActive : colFalse);
          if (showIds) drawTag(octx, cx, cy, `${bp.id}: Nein`);
        }
      } else {
        const t = f as any;
        if (t.x != null && t.y != null) {
          const cx = Math.round(t.x);
          const cy = Math.round(ol.height - t.y);
          drawDot(octx, cx, cy, i === idx ? colActive : colPlaced);
          const fontSize = (t.size ?? fontSizeGlobal) as number;
          const scaledFont = Math.max(8, Math.round(fontSize * scale));
          if (t.w) {
            const scaledW = Math.max(0, Math.round((t.w as number) * scale));
            const top = cy - (scaledFont + 2);
            const height = scaledFont + Math.round(6 * scale);
            octx.save();
            const isMoney = /betrag|wert|eur|€/i.test(String(t.id||''));
            octx.globalAlpha = 0.20;
            octx.fillStyle = isMoney
              ? (css.getPropertyValue('--color-base-gold') || '#ffc300')
              : (css.getPropertyValue('--color-action-secondary') || '#0ea5e933');
            octx.fillRect(cx, top, scaledW, height);
            octx.restore();
            const txt = sampleText(t);
            octx.save();
            // Dark text so it is visible on white PDF background
            octx.fillStyle = css.getPropertyValue('--color-base-ink') || '#111111';
            octx.font = `${scaledFont}px ui-sans-serif, system-ui`;
            // overflow check
            const metrics = octx.measureText(txt);
            const tWidth = metrics.width; // pixels on canvas
            const effW = scaledW; // compare in canvas pixels
            if (tWidth > effW) {
              setOverflowInfo({ id: String(t.id), width: Math.round(tWidth), w: effW });
            } else if (overflowInfo && overflowInfo.id === String(t.id)) {
              setOverflowInfo(null);
            }
            if (t.align === 'right') {
              octx.textAlign = 'right';
              octx.fillText(txt, cx + scaledW - 2, cy - scaledFont);
            } else {
              octx.textAlign = 'left';
              octx.fillText(txt, cx + 2, cy - scaledFont);
            }
            octx.restore();
            // Always show field name label
            drawTag(octx, cx, cy, `${t.id}`);
            // resize handle for width
            const hx = cx + scaledW;
            const hy = cy - Math.round(scaledFont/2);
            octx.save();
            octx.fillStyle = (css.getPropertyValue('--color-base-gold') || '#ffc300') as any;
            octx.strokeStyle = '#1f2937';
            const hs = Math.max(8, Math.round(8*scale));
            octx.fillRect(hx-2, hy-hs/2, 4, hs);
            octx.restore();
          } else {
            drawTag(octx, cx, cy, `${t.id}: ${sampleText(t)}`);
          }
        }
      }
    });
  };

  // Keyboard nudging: arrows move current field, Shift = 5pt
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current) return;
      const step = e.shiftKey ? 5 : 1;
      const copy = [...fields] as any[];
      const f = { ...(copy[idx] as any) };
      let changed = false;
      if ((f as any).type === 'boolean_pair') {
        // Move both Ja/Nein for arrows
        if (e.key === 'ArrowLeft') { if (f.x_true!=null) f.x_true-=step; if (f.x_false!=null) f.x_false-=step; changed=true; }
        if (e.key === 'ArrowRight') { if (f.x_true!=null) f.x_true+=step; if (f.x_false!=null) f.x_false+=step; changed=true; }
        if (e.key === 'ArrowUp') { if (f.y_true!=null) f.y_true+=step; if (f.y_false!=null) f.y_false+=step; changed=true; }
        if (e.key === 'ArrowDown') { if (f.y_true!=null) f.y_true-=step; if (f.y_false!=null) f.y_false-=step; changed=true; }
      } else {
        if (e.key === 'ArrowLeft') { if (f.x!=null) f.x-=step; changed=true; }
        if (e.key === 'ArrowRight') { if (f.x!=null) f.x+=step; changed=true; }
        if (e.key === 'ArrowUp') { if (f.y!=null) f.y+=step; changed=true; }
        if (e.key === 'ArrowDown') { if (f.y!=null) f.y-=step; changed=true; }
      }
      if (changed) {
        e.preventDefault();
        copy[idx] = f;
        setFields(copy as any);
        drawOverlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fields, idx, current]);

  const drawDot = (ctx: CanvasRenderingContext2D, x:number, y:number, color:string) => {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = "#1f2937";
    ctx.beginPath();
    const r = Math.max(5, Math.round(scale * 5)); ctx.arc(x, y, r, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
  const drawTag = (ctx: CanvasRenderingContext2D, x:number, y:number, text:string) => {
    if (!text) return;
    const css = getComputedStyle(document.body);
    const bg = css.getPropertyValue('--color-base-gold') || '#ffc300';
    const fg = css.getPropertyValue('--color-base-ink') || '#02080c';
    ctx.save();
    const fs = Math.max(12, Math.round(11 * scale)); ctx.font = `${fs}px ui-sans-serif, system-ui`;
    const padX = 6;
    const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
    const h = Math.max(18, Math.round(18 * scale));
    const rx = x + 10, ry = y + 6;
    const r = 6;
    ctx.beginPath();
    ctx.moveTo(rx + r, ry);
    ctx.arcTo(rx + w, ry, rx + w, ry + h, r);
    ctx.arcTo(rx + w, ry + h, rx, ry + h, r);
    ctx.arcTo(rx, ry + h, rx, ry, r);
    ctx.arcTo(rx, ry, rx + w, ry, r);
    ctx.closePath();
    ctx.globalAlpha = 1;
    ctx.fillStyle = bg as any;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = fg as any;
    const padY = Math.max(4, Math.round(4*scale)); ctx.fillText(text, rx + padX, ry + padY);
    ctx.restore();
  };

  const onPdfFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = function () {
      const typedarray = new Uint8Array(this.result as ArrayBuffer);
      setPdfBuffer(this.result as ArrayBuffer);
      const load = (opts: any) => (pdfjsRef.current as any)?.getDocument(opts).promise;
      if (!load) { alert('PDF-Bibliothek noch nicht geladen. Bitte einen Moment warten.'); return; }
      load({ data: typedarray })
        .then((pdf: any) => { setFallbackUrl(null); setPdfDoc(pdf); })
        .catch((e:any) => {
          console.error("Load error:", e);
          const url = URL.createObjectURL(file);
          setFallbackUrl(url);
        });
    };
    reader.readAsArrayBuffer(file);
  };

  // Client-side Test-PDF Rendering using pdf-lib and current previewData
  const renderTestPdf = async () => {
    if (!pdfBuffer) { alert('Bitte zuerst ein PDF laden.'); return; }
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const doc = await PDFDocument.load(pdfBuffer);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.getPage(0);
    const mapFontSize = (mapping?.size as number) || 10;
    const drawText = (text:string, x:number, y:number, size:number, align: 'left'|'right') => {
      const w = helv.widthOfTextAtSize(text, size);
      const dx = align === 'right' ? x + (0) - 2 : x + 2;
      const tx = align === 'right' ? x - 2 : x + 2;
      page.drawText(text, { x: align==='right' ? x - w - 2 : x + 2, y: y - size, size, font: helv, color: rgb(0,0,0) });
    };
    const values = previewData || {};
    for (const f of fields as any[]) {
      const t = (f.type || 'text') as string;
      if (t === 'boolean_pair') {
        const val = String(values[f.id] ?? '').toLowerCase();
        const truthy = val === 'true' || val === '1' || val === 'ja';
        if (truthy && f.x_true != null && f.y_true != null) page.drawText('X', { x: f.x_true, y: f.y_true, size: mapFontSize, font: helv, color: rgb(0,0,0) });
        if (!truthy && f.x_false != null && f.y_false != null) page.drawText('X', { x: f.x_false, y: f.y_false, size: mapFontSize, font: helv, color: rgb(0,0,0) });
        continue;
      }
      if (f.x == null || f.y == null) continue;
      let text = String(values[f.id] ?? '');
      if (t === 'date_de' && text) {
        // einfache Normalisierung
        const m = text.match(/(\d{1,2})[\.\/-](\d{1,2})[\.\/-](\d{2,4})/);
        if (m) text = `${m[1].padStart(2,'0')}.${m[2].padStart(2,'0')}.${m[3].length===2?('20'+m[3]):m[3]}`;
      }
      const size = (f.size ?? mapFontSize) as number;
      const align = (f.align === 'right') ? 'right' : 'left';
      if (align==='right' && f.w) {
        const w = helv.widthOfTextAtSize(text, size);
        const x = f.x + Math.max(0, (f.w as number) - w);
        page.drawText(text, { x, y: f.y - size, size, font: helv, color: rgb(0,0,0) });
      } else {
        page.drawText(text, { x: f.x + 2, y: f.y - size, size, font: helv, color: rgb(0,0,0) });
      }
    }
    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'out_test.pdf';
    a.click();
  };

  const onMapFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const map = JSON.parse(this.result as string) as Mapping;
        // filter out ID_USER for placement
        map.fields = (map.fields || []).filter((f: any) => f.id !== "ID_USER");
        setMapping(map);
        setFields(map.fields || []);
        setIdx(0);
        setAwaitingFalse(false);
      } catch (e) {
        alert("Mapping konnte nicht gelesen werden.");
      }
    };
    reader.readAsText(file, "utf-8");
  };

  const onDemoFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(this.result as string) as Record<string, any>;
        setPreviewData(data || {});
        drawOverlay();
      } catch {
        alert('Demo-Daten (JSON) konnten nicht gelesen werden.');
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Vereinfachung: Klick setzt immer, damit Felder jederzeit platzier- und verschiebbar sind
    if (!current || !page) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const base = overlayRef.current || (e.target as HTMLCanvasElement);
    let x = Math.round(e.clientX - rect.left);
    let y = Math.round((base as HTMLCanvasElement).height - (e.clientY - rect.top));
    if (snap && snap > 1) { x = Math.round(x / snap) * snap; y = Math.round(y / snap) * snap; }

    const copy = [...fields] as any[];
    const f = { ...(copy[idx] as any) };
    if (f.type === "boolean_pair") {
      if (f.x_true == null || f.y_true == null) {
        f.x_true = x; f.y_true = y; setAwaitingFalse(true);
      } else if (awaitingFalse || f.x_false == null || f.y_false == null) {
        f.x_false = x; f.y_false = y; setAwaitingFalse(false); setIdx(Math.min(idx + 1, fields.length - 1));
      }
    } else {
      f.x = x; f.y = y;
      if (autoAdvance) setIdx(Math.min(idx + 1, fields.length - 1));
    }
    copy[idx] = f as any;
    setFields(copy as any);
    // redraw markers
    drawOverlay();
  };

  const saveMapping = () => {
    if (!mapping) return;
    const out = { ...mapping, fields };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mapping_updated.json";
    a.click();
  };

  const zoomChanged = async (val: number) => {
    setScale(val);
    if (page) await renderPage(page, val);
  };

  useEffect(() => { drawOverlay(); }, [fields, idx, scale, page]);

  return (
    <div className="grid grid-cols-[320px_1fr] h-screen">
      <aside className="border-r border-slate-200 p-3 space-y-3 overflow-auto">
        <h3 className="font-semibold">Mapping platzieren</h3>
        <div className="well text-xs leading-5">
          1) PDF laden • 2) Mapping laden • 3) Feld wählen • 4) In PDF klicken (bei Ja/Nein zweimal). Markierungen sind verschiebbar: Marker anklicken und ziehen. Speichern lädt die aktualisierte JSON herunter.
        </div>
        <div className="flex gap-2 text-sm">
          <button className="px-2 py-1 border rounded" onClick={()=>{ document.body.classList.remove('theme-light','theme-graphite'); drawOverlay(); }}>Dark</button>
          <button className="px-2 py-1 border rounded" onClick={()=>{ document.body.classList.add('theme-light'); document.body.classList.remove('theme-graphite'); drawOverlay(); }}>Light</button>
          <button className="px-2 py-1 border rounded" onClick={()=>{ document.body.classList.add('theme-graphite'); document.body.classList.remove('theme-light'); drawOverlay(); }}>Graphit</button>
        </div>

        <div className="flex gap-2 text-sm">
          <button className={`px-2 py-1 border rounded ${placingMode?'brightness-110':''}`} onClick={()=> setPlacingMode(true)}>Platzieren</button>
          <button className="px-2 py-1 border rounded" onClick={()=> setPlacingMode(false)}>Bestätigen</button>
          <button className="px-2 py-1 border rounded" onClick={()=> { setPlacingMode(false); }}>Abbrechen</button>
        </div>
        <div className="flex gap-2 text-xs">
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={autoAdvance} onChange={e=>setAutoAdvance(e.target.checked)} /> Auto‑Weiter</label>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={showGrid} onChange={e=>{ setShowGrid(e.target.checked); drawOverlay(); }} /> Raster</label>
          <label className="inline-flex items-center gap-1">Snap
            <select value={snap} onChange={e=>{ const v=parseInt(e.target.value); setSnap(v); }}>
              <option value={1}>aus</option>
              <option value={5}>5px</option>
              <option value={10}>10px</option>
              <option value={25}>25px</option>
            </select>
          </label>
        </div>

        <div>
          <label className="block text-sm mb-1">PDF laden</label>
          <input type="file" accept="application/pdf" onChange={(e)=>{ const f=e.target.files?.[0]; if (f) onPdfFile(f); }} />
        </div>

        <div>
          <label className="block text-sm mb-1">Mapping laden (JSON)</label>
          <input type="file" accept="application/json" onChange={(e)=>{ const f=e.target.files?.[0]; if (f) onMapFile(f); }} />
        </div>

        <div>
          <label className="block text-sm mb-1">Demo‑Daten (optional, JSON)</label>
          <input type="file" accept="application/json" onChange={(e)=>{ const f=e.target.files?.[0]; if (f) onDemoFile(f); }} />
          <div className="mt-2 flex gap-2 text-xs">
            <button className="px-2 py-1 border rounded" onClick={()=>{ setShowIds(s=>!s); drawOverlay(); }}>{showIds ? 'IDs ausblenden' : 'IDs einblenden'}</button>
            <button className="px-2 py-1 border rounded" onClick={()=>{ setShowValues(s=>!s); drawOverlay(); }}>{showValues ? 'Werte ausblenden' : 'Werte einblenden'}</button>
          </div>
          {/* Field list moved to right rail */}
          <div className="field-list max-h-64 overflow-auto border rounded mt-3">
            {(fields || []).map((f, i) => {
              const placed = (f as any).type === 'boolean_pair'
                ? (f as any).x_true != null && (f as any).y_true != null && (f as any).x_false != null && (f as any).y_false != null
                : (f as any).x != null && (f as any).y != null;
              return (
                <button key={(f as any).id}
                  className={`w-full text-left px-2 py-1 text-sm border-b last:border-0 hover:brightness-110 ${i===idx? 'brightness-110' : ''}`}
                  onClick={()=>{ setIdx(i); setAwaitingFalse(false); }}>
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-2"
                    style={{ backgroundColor: placed ? 'var(--color-status-success)' : 'var(--color-border-primary)' }}
                  />
                  {(f as any).id}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2">
          <button className="px-2 py-1 border rounded" onClick={()=>{ setIdx(Math.max(0, idx-1)); setAwaitingFalse(false); }}>◀ Zurück</button>
          <button className="px-2 py-1 border rounded" onClick={()=>{ setIdx(Math.min(fields.length-1, idx+1)); setAwaitingFalse(false); }}>Weiter ▶</button>
        </div>

        <div className="text-sm">
          <div>Feld: <span className="font-medium">{current?.id ?? "–"}</span>
            <span className="ml-2 inline-block text-xs px-2 py-0.5 rounded border">{displayType(current)}</span>
          </div>
          <p className="text-slate-600 mt-1">Klicken Sie ins PDF, um die Position zu setzen. Bei Ja/Nein‑Feldern: erst „Ja“, dann „Nein“. Marker lassen sich per Ziehen feinjustieren.</p>
        </div>

        <button className="px-3 py-1.5 border rounded" onClick={saveMapping}>Speichern</button>

        <div>
          <label className="block text-sm mb-1">Zoom</label>
          <input type="range" min={0.5} max={2.5} defaultValue={scale} step={0.1} onChange={(e)=>zoomChanged(parseFloat(e.target.value))} />
        </div>

        <div className="text-sm">Koordinate: <code>{hoverXY ? `x=${hoverXY.x}, y=${hoverXY.y}` : '-'}</code></div>
      </aside>

      <main className="app-main grid place-items-center">
        <div className="pdf-frame relative">
          {fallbackUrl ? (
            <embed src={`${fallbackUrl}#zoom=page-width`} type="application/pdf" className="w-[900px] h-[1200px]" />
          ) : (
            <>
              <canvas ref={canvasRef} className="block" />
              <canvas
                ref={overlayRef}
                className="absolute inset-0 cursor-crosshair"
                onClick={onCanvasClick}
                onMouseDown={(e)=>{
                  if (!overlayRef.current) return;
                  // hit-test current field markers for drag
                  const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
                  const px = Math.round(e.clientX - rect.left);
                  const py = Math.round(e.clientY - rect.top);
                  const radius = 8;
                  const h = (e.target as HTMLCanvasElement).height;
                  const cur = fields[idx] as any;
                  if (!cur) return;
                  if (cur.type === 'boolean_pair') {
                    if (cur.x_true != null && cur.y_true != null) {
                      const cx = cur.x_true, cy = h - cur.y_true;
                      if (Math.hypot(px-cx, py-cy) <= radius) { setDrag({kind:'bp_true', i: idx}); return; }
                    }
                    if (cur.x_false != null && cur.y_false != null) {
                      const cx = cur.x_false, cy = h - cur.y_false;
                      if (Math.hypot(px-cx, py-cy) <= radius) { setDrag({kind:'bp_false', i: idx}); return; }
                    }
                  } else if (cur.x != null && cur.y != null) {
                    const cx = cur.x, cy = h - cur.y;
                    if (Math.hypot(px-cx, py-cy) <= radius) { setDrag({kind:'text', i: idx}); return; }
                    // hit test width handle if exists
                    if (cur.w) {
                      const hx = cx + Math.round(cur.w);
                      const hy = h - (cur.y + Math.round((cur.size ?? mapping?.size ?? 12)/2));
                      if (Math.abs(px - hx) <= 6 && Math.abs(py - hy) <= Math.max(10, Math.round(10*scale))) {
                        setResizeW({ i: idx });
                        return;
                      }
                    }
                  }
                }}
                onMouseUp={()=> { setDrag(null); setResizeW(null); }}
                onMouseMove={(e)=>{
                  const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
                  const x = Math.round(e.clientX - rect.left);
                  const yCanvas = Math.round((e.target as HTMLCanvasElement).height - (e.clientY - rect.top));
                  setHoverXY({x, y: yCanvas});
                  if (resizeW) {
                    const copy = [...fields] as any[];
                    const f = { ...(copy[resizeW.i] as any) };
                    const baseX = f.x ?? 0;
                    let newW = x - baseX;
                    if (snap && snap>1) newW = Math.max(10, Math.round(newW/snap)*snap);
                    f.w = Math.max(10, newW);
                    copy[resizeW.i] = f;
                    setFields(copy as any);
                    drawOverlay();
                  } else if (drag) {
                    const copy = [...fields] as any[];
                    const f = { ...(copy[drag.i] as any) };
                    if (drag.kind === 'text') { f.x = x; f.y = yCanvas; }
                    if (drag.kind === 'bp_true') { f.x_true = x; f.y_true = yCanvas; }
                    if (drag.kind === 'bp_false') { f.x_false = x; f.y_false = yCanvas; }
                    copy[drag.i] = f;
                    setFields(copy as any);
                    drawOverlay();
                  }
                }}
                onMouseLeave={()=>setHoverXY(null)}
              />
            </>
          )}
        </div>
        {/* Right tool rail */}
        <div className="side-rail">
          <div className="p-3 space-y-3">
            <div className="flex gap-2 text-sm">
              <button className={`px-2 py-1 border rounded ${placingMode?'brightness-110':''}`} onClick={()=> setPlacingMode(true)}>Platzieren</button>
              <button className="px-2 py-1 border rounded" onClick={()=> setPlacingMode(false)}>Bestätigen</button>
              <button className="px-2 py-1 border rounded" onClick={()=> { setPlacingMode(false); }}>Abbrechen</button>
            </div>
            <div className="flex gap-2 text-xs">
              <label className="inline-flex items-center gap-1"><input type="checkbox" checked={autoAdvance} onChange={e=>setAutoAdvance(e.target.checked)} /> Auto‑Weiter</label>
              <label className="inline-flex items-center gap-1"><input type="checkbox" checked={showGrid} onChange={e=>{ setShowGrid(e.target.checked); drawOverlay(); }} /> Raster</label>
              <label className="inline-flex items-center gap-1">Snap
                <select value={snap} onChange={e=>{ const v=parseInt(e.target.value); setSnap(v); }}>
                  <option value={1}>aus</option>
                  <option value={5}>5px</option>
                  <option value={10}>10px</option>
                  <option value={25}>25px</option>
                </select>
              </label>
            </div>
            <div className="text-sm">
              <div>Feld: <span className="font-medium">{current?.id ?? "–"}</span>
                <span className="ml-2 inline-block text-xs px-2 py-0.5 rounded border">{displayType(current)}</span>
              </div>
              {overflowInfo && current && String(current.id) === overflowInfo.id ? (
                <div className="mt-1 text-xs" style={{color: 'var(--color-base-gold)'}}>
                  Hinweis: Textbreite {overflowInfo.width}
                  {'>'}
                  Feldbreite {overflowInfo.w} (pt). W erhöhen oder Size verringern.
                </div>
              ) : null}
            </div>
            {/* Inspector */}
            <div className="text-xs grid grid-cols-2 gap-2">
              {current && (current as any).type !== 'boolean_pair' ? (
                <>
                  <label className="col-span-1">X<input className="w-full" type="number" value={(current as any).x ?? ''} onChange={e=>{ const v=Number(e.target.value||0); const copy=[...fields] as any[]; copy[idx] = {...(copy[idx] as any), x:v}; setFields(copy as any); drawOverlay(); }} /></label>
                  <label className="col-span-1">Y<input className="w-full" type="number" value={(current as any).y ?? ''} onChange={e=>{ const v=Number(e.target.value||0); const copy=[...fields] as any[]; copy[idx] = {...(copy[idx] as any), y:v}; setFields(copy as any); drawOverlay(); }} /></label>
                  <label className="col-span-1">W<input className="w-full" type="number" value={(current as any).w ?? ''} onChange={e=>{ const v=Number(e.target.value||0); const copy=[...fields] as any[]; copy[idx] = {...(copy[idx] as any), w:Math.max(0,v)}; setFields(copy as any); drawOverlay(); }} /></label>
                  <label className="col-span-1">Size<input className="w-full" type="number" value={(current as any).size ?? ''} onChange={e=>{ const v=Number(e.target.value||0); const copy=[...fields] as any[]; copy[idx] = {...(copy[idx] as any), size:Math.max(6,v)}; setFields(copy as any); drawOverlay(); }} /></label>
                  <label className="col-span-2">Align
                    <select className="w-full" value={(current as any).align ?? 'left'} onChange={e=>{ const copy=[...fields] as any[]; copy[idx] = {...(copy[idx] as any), align:e.target.value}; setFields(copy as any); drawOverlay(); }}>
                      <option value="left">Links</option>
                      <option value="right">Rechts</option>
                    </select>
                  </label>
                </>
              ) : current ? (
                <>
                  <label className="col-span-1">Ja X<input className="w-full" type="number" value={(current as any).x_true ?? ''} onChange={e=>{ const v=Number(e.target.value||0); const copy=[...fields] as any[]; copy[idx] = {...(copy[idx] as any), x_true:v}; setFields(copy as any); drawOverlay(); }} /></label>
                  <label className="col-span-1">Ja Y<input className="w-full" type="number" value={(current as any).y_true ?? ''} onChange={e=>{ const v=Number(e.target.value||0); const copy=[...fields] as any[]; copy[idx] = {...(copy[idx] as any), y_true:v}; setFields(copy as any); drawOverlay(); }} /></label>
                  <label className="col-span-1">Nein X<input className="w-full" type="number" value={(current as any).x_false ?? ''} onChange={e=>{ const v=Number(e.target.value||0); const copy=[...fields] as any[]; copy[idx] = {...(copy[idx] as any), x_false:v}; setFields(copy as any); drawOverlay(); }} /></label>
                  <label className="col-span-1">Nein Y<input className="w-full" type="number" value={(current as any).y_false ?? ''} onChange={e=>{ const v=Number(e.target.value||0); const copy=[...fields] as any[]; copy[idx] = {...(copy[idx] as any), y_false:v}; setFields(copy as any); drawOverlay(); }} /></label>
                </>
              ) : null}
            </div>
            <div className="flex gap-2">
              <button className="px-2 py-1 border rounded" onClick={()=>{ setIdx(Math.max(0, idx-1)); setAwaitingFalse(false); }}>◀ Zurück</button>
              <button className="px-2 py-1 border rounded" onClick={()=>{ setIdx(Math.min(fields.length-1, idx+1)); setAwaitingFalse(false); }}>Weiter ▶</button>
            </div>
            <button className="px-3 py-1.5 border rounded w-full" onClick={saveMapping}>Speichern</button>
            <button className="px-3 py-1.5 border rounded w-full" onClick={renderTestPdf} title="Erzeugt ein Test-PDF mit den Demo-Daten">Test‑PDF erstellen</button>
            <div>
              <label className="block text-sm mb-1">Zoom</label>
              <input type="range" min={0.5} max={2.5} defaultValue={scale} step={0.1} onChange={(e)=>zoomChanged(parseFloat(e.target.value))} />
            </div>
            <div className="text-sm">Koordinate: <code>{hoverXY ? `x=${hoverXY.x}, y=${hoverXY.y}` : '-'}</code></div>
          </div>
        </div>
      </main>
    </div>
  );
}













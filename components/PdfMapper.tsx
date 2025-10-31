"use client";

import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";

// Use locally served worker (public/pdf.worker.min.js) for offline + Vercel
// Prefer ESM worker (pdf.worker.min.mjs); script copies into /public on install
GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

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

  const current = fields[idx];

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
    // style
    octx.font = "12px ui-sans-serif, system-ui";
    octx.textBaseline = "top";
    const css = getComputedStyle(document.body);
    const colActive = css.getPropertyValue('--color-action-primary').trim() || '#0ea5e9';
    const colPlaced = css.getPropertyValue('--color-status-info').trim() || '#2563eb';
    const colTrue = css.getPropertyValue('--color-status-success').trim() || '#16a34a';
    const colFalse = css.getPropertyValue('--color-status-error').trim() || '#ef4444';
    // draw each placed marker
    fields.forEach((f, i) => {
      if ((f as any).type === "boolean_pair") {
        const bp = f as any;
        if (bp.x_true != null && bp.y_true != null) {
          const cx = Math.round(bp.x_true);
          const cy = Math.round(ol.height - bp.y_true);
          drawDot(octx, cx, cy, i === idx ? colActive : colTrue);
          octx.fillStyle = "#0f172a";
          octx.fillText(`${bp.id}:T`, cx + 6, cy + 6);
        }
        if (bp.x_false != null && bp.y_false != null) {
          const cx = Math.round(bp.x_false);
          const cy = Math.round(ol.height - bp.y_false);
          drawDot(octx, cx, cy, i === idx ? colActive : colFalse);
          octx.fillStyle = "#0f172a";
          octx.fillText(`${bp.id}:F`, cx + 6, cy + 6);
        }
      } else {
        const t = f as any;
        if (t.x != null && t.y != null) {
          const cx = Math.round(t.x);
          const cy = Math.round(ol.height - t.y);
          drawDot(octx, cx, cy, i === idx ? colActive : colPlaced);
          octx.fillStyle = "#0f172a";
          octx.fillText(`${t.id}`, cx + 6, cy + 6);
        }
      }
    });
  };

  const drawDot = (ctx: CanvasRenderingContext2D, x:number, y:number, color:string) => {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = "#1f2937";
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  const onPdfFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = function () {
      const typedarray = new Uint8Array(this.result as ArrayBuffer);
      const load = (opts: any) => getDocument(opts).promise;
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

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!current || !page) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const base = overlayRef.current || (e.target as HTMLCanvasElement);
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round((base as HTMLCanvasElement).height - (e.clientY - rect.top));

    const copy = [...fields] as any[];
    const f = { ...(copy[idx] as any) };
    if (f.type === "boolean_pair") {
      if (f.x_true == null || f.y_true == null) {
        f.x_true = x; f.y_true = y; setAwaitingFalse(true);
      } else if (awaitingFalse || f.x_false == null || f.y_false == null) {
        f.x_false = x; f.y_false = y; setAwaitingFalse(false); setIdx(Math.min(idx + 1, fields.length - 1));
      }
    } else {
      f.x = x; f.y = y; setIdx(Math.min(idx + 1, fields.length - 1));
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

        <div>
          <label className="block text-sm mb-1">PDF laden</label>
          <input type="file" accept="application/pdf" onChange={(e)=>{ const f=e.target.files?.[0]; if (f) onPdfFile(f); }} />
        </div>

        <div>
          <label className="block text-sm mb-1">Mapping laden (JSON)</label>
          <input type="file" accept="application/json" onChange={(e)=>{ const f=e.target.files?.[0]; if (f) onMapFile(f); }} />
        </div>

        <div className="flex gap-2">
          <button className="px-2 py-1 border rounded" onClick={()=>{ setIdx(Math.max(0, idx-1)); setAwaitingFalse(false); }}>◀ Zurück</button>
          <button className="px-2 py-1 border rounded" onClick={()=>{ setIdx(Math.min(fields.length-1, idx+1)); setAwaitingFalse(false); }}>Weiter ▶</button>
        </div>

        <div className="text-sm">
          <div>Aktuelles Feld: <span className="font-medium">{current?.id ?? "–"}</span>
            <span className="ml-2 inline-block text-xs px-2 py-0.5 rounded border">{(current as any)?.type ?? "text"}</span>
          </div>
          <p className="text-slate-600 mt-1">Klick auf die Zielposition im PDF. Bei <code>boolean_pair</code> zuerst Ja/True, dann Nein/False.</p>
        </div>

        {/* Field list */}
        <div className="field-list max-h-64 overflow-auto border rounded">
          {(fields || []).map((f, i) => {
            const placed = (f as any).type === "boolean_pair"
              ? (f as any).x_true != null && (f as any).y_true != null && (f as any).x_false != null && (f as any).y_false != null
              : (f as any).x != null && (f as any).y != null;
            return (
              <button key={(f as any).id}
                className={`w-full text-left px-2 py-1 text-sm border-b last:border-0 hover:brightness-110 ${i===idx? 'brightness-110' : ''}`}
                onClick={()=>{ setIdx(i); setAwaitingFalse(false); }}>
                <span
                  className="inline-block w-2 h-2 rounded-full mr-2"
                  style={{
                    backgroundColor: placed ? 'var(--color-status-success)' : 'var(--color-border-primary)'
                  }}
                />
                {(f as any).id}
              </button>
            );
          })}
        </div>

        <button className="px-3 py-1.5 border rounded" onClick={saveMapping}>Mapping speichern</button>

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
                  }
                }}
                onMouseUp={()=> setDrag(null)}
                onMouseMove={(e)=>{
                  const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
                  const x = Math.round(e.clientX - rect.left);
                  const yCanvas = Math.round((e.target as HTMLCanvasElement).height - (e.clientY - rect.top));
                  setHoverXY({x, y: yCanvas});
                  if (drag) {
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
      </main>
    </div>
  );
}

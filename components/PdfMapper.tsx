"use client";

import { useEffect, useRef, useState } from "react";
// pdf.js is loaded dynamically on the client to avoid SSR build issues on Node 20

type MappingField =
  | { id: string; page: number; type?: "text" | "date_de" | "checkbox"; x: number | null; y: number | null; w?: number; align?: "left" | "right" }
  | { id: string; page: number; type: "boolean_pair"; x_true: number | null; y_true: number | null; x_false: number | null; y_false: number | null };

type Mapping = {
  template?: string; // Deprecated: Nur für Kompatibilität
  template_sha256?: string; // Hash zur Template-Identifikation
  template_source?: string; // Dateiname des Templates (z.B. "034122_mit.pdf")
  font?: string;
  size?: number;
  status?: string;
  fields: MappingField[];
};

type PdfMapperProps = {
  initialMapping?: Mapping | null;
  initialPdf?: File | null;
  onMappingComplete?: (mapping: Mapping) => void;
  onExport?: () => void;
};

export default function PdfMapper({
  initialMapping = null,
  initialPdf = null,
  onMappingComplete,
  onExport
}: PdfMapperProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const pdfjsRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null); // Track laufende Render-Tasks
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
  const [autoAdvance, setAutoAdvance] = useState(true); // Default: aktiviert für schnelleres Mapping
  const [showGrid, setShowGrid] = useState(true);
  const [gridSize, setGridSize] = useState(20); // Variable Grid-Größe
  const [snap, setSnap] = useState(5); // px
  const [resizeW, setResizeW] = useState<null | { i:number }>(null);
  const [overflowInfo, setOverflowInfo] = useState<null | { id:string; width:number; w:number }>(null);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null); // Dateiname des geladenen PDFs
  const [pdfHash, setPdfHash] = useState<string | null>(null); // Hash des geladenen PDFs
  const [confirmedFields, setConfirmedFields] = useState<Set<number>>(new Set()); // Bestätigte Felder
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportTemplateId, setExportTemplateId] = useState("034122-spendenbescheinigung-geld");

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
      try {
        console.log('📚 Lade PDF.js...');
        const pdfjs = await import("pdfjs-dist");
        // worker from public/
        try {
          (pdfjs as any).GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
          console.log('✅ PDF.js Worker konfiguriert: /pdf.worker.min.mjs');
        } catch (e) {
          console.error('❌ Fehler beim Konfigurieren des PDF.js Workers:', e);
        }
        if (mounted) {
          pdfjsRef.current = pdfjs;
          console.log('✅ PDF.js geladen und bereit');
          // WICHTIG: Wenn initialPdf bereits vorhanden ist, trigger PDF-Laden
          if (initialPdf && !pdfDoc) {
            console.log('🔄 PDF.js bereit - trigger PDF-Laden für:', initialPdf.name);
            // Force re-trigger durch Reset pdfFileName
            setPdfFileName(null);
          }
        }
      } catch (err) {
        console.error('❌ Fehler beim Laden von PDF.js:', err);
      }
    })();
    return () => { mounted = false; };
  }, [initialPdf, pdfDoc]); // Dependencies hinzugefügt

  // Load initial PDF and Mapping from props
  useEffect(() => {
    console.log('🔍 initialPdf useEffect:', {
      hasInitialPdf: !!initialPdf,
      pdfFileName,
      hasPdfDoc: !!pdfDoc,
      hasPdfjs: !!pdfjsRef.current,
      initialPdfName: initialPdf?.name,
      pdfjsGetDocument: !!pdfjsRef.current?.getDocument
    });

    // Prüfe ob initialPdf sich geändert hat (anhand Name) ODER ob PDF.js gerade geladen wurde
    // WICHTIG: Wenn pdfFileName null ist UND PDF.js verfügbar ist UND initialPdf vorhanden ist, lade neu
    const shouldReload = initialPdf && pdfjsRef.current && (
      pdfFileName !== initialPdf.name ||
      !pdfDoc ||
      (pdfFileName === null || pdfFileName.startsWith('_trigger_')) // Trigger-Pattern erkannt
    );

    if (!initialPdf) {
      console.log('⏳ Kein initialPdf vorhanden');
      return;
    }

    if (!pdfjsRef.current) {
      console.log('⏳ Warte auf PDF.js Worker...');
      // Retry mit mehreren Versuchen
      let attempts = 0;
      const maxAttempts = 20; // 10 Sekunden max
      const checkPdfjs = () => {
        attempts++;
        if (pdfjsRef.current && initialPdf) {
          console.log('✅ PDF.js Worker jetzt verfügbar nach', attempts, 'Versuchen - trigger PDF-Laden');
          // WICHTIG: Reset states um sicherzustellen, dass der Reload getriggert wird
          setPdfDoc(null);
          // Setze pdfFileName auf einen anderen Wert, dann zurück - das triggert useEffect
          setPdfFileName('_trigger_' + Date.now());
          setTimeout(() => {
            setPdfFileName(null); // Reset - das sollte den useEffect erneut triggern
          }, 50);
        } else if (attempts < maxAttempts) {
          setTimeout(checkPdfjs, 500);
        } else {
          console.error('❌ PDF.js Worker nicht verfügbar nach', maxAttempts, 'Versuchen');
        }
      };
      setTimeout(checkPdfjs, 500);
      return;
    }

    if (shouldReload) {
      console.log('📄 PdfMapper: Lade PDF aus Props:', initialPdf.name, {
        shouldReload,
        pdfFileName,
        hasPdfDoc: !!pdfDoc,
        hasPdfjs: !!pdfjsRef.current,
        pdfjsGetDocument: !!pdfjsRef.current?.getDocument
      });

      // Prüfe ob initialPdf ein echtes File-Objekt ist
      if (!(initialPdf instanceof File)) {
        console.error('❌ initialPdf ist kein File-Objekt:', initialPdf);
        return;
      }

      // Prüfe ob PDF.js wirklich verfügbar ist
      if (!pdfjsRef.current || !pdfjsRef.current.getDocument) {
        console.error('❌ PDF.js getDocument nicht verfügbar!', {
          hasPdfjs: !!pdfjsRef.current,
          hasGetDocument: !!pdfjsRef.current?.getDocument
        });
        return;
      }

      const reader = new FileReader();
      reader.onerror = (err) => {
        console.error('❌ FileReader Fehler:', err);
      };

      reader.onload = async (e) => {
        try {
          const typedarray = new Uint8Array(e.target?.result as ArrayBuffer);
          setPdfBuffer(typedarray.buffer);
          setPdfFileName(initialPdf.name);
          console.log('📄 PDF als ArrayBuffer geladen:', typedarray.length, 'Bytes');

          // Calculate hash
          const hashBuffer = await crypto.subtle.digest('SHA-256', typedarray.buffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          setPdfHash(hashHex);
          console.log('📄 PdfMapper: PDF Hash berechnet:', hashHex.substring(0, 16) + '...');

          const load = (pdfjsRef.current as any)?.getDocument;
          if (load) {
            console.log('📄 Starte PDF.js getDocument...');
            load({ data: typedarray }).promise
              .then((pdf: any) => {
                console.log('✅ PdfMapper: PDF geladen, Seiten:', pdf.numPages);
                setPdfDoc(pdf);
              })
              .catch((err: any) => {
                console.error("❌ PdfMapper: PDF load error:", err);
                const url = URL.createObjectURL(initialPdf);
                setFallbackUrl(url);
                console.log('📄 Fallback: URL erstellt:', url);
              });
          } else {
            console.error('❌ PDF.js getDocument nicht verfügbar!');
          }
        } catch (err) {
          console.error('❌ Fehler beim Verarbeiten des PDFs:', err);
        }
      };
      reader.readAsArrayBuffer(initialPdf);
    } else if (initialPdf) {
      console.log('📄 PdfMapper: PDF bereits geladen, überspringe:', initialPdf.name);
    }
  }, [initialPdf, pdfDoc, pdfFileName]);

  // Load initial Mapping from props
  useEffect(() => {
    // Prüfe ob initialMapping sich geändert hat (anhand Anzahl Felder)
    const shouldReload = initialMapping && (
      !mapping ||
      mapping.fields?.length !== initialMapping.fields?.length ||
      mapping.template_sha256 !== initialMapping.template_sha256
    );

    if (initialMapping && shouldReload) {
      console.log('🗺️ PdfMapper: Lade Mapping aus Props:', {
        fieldsCount: initialMapping.fields?.length || 0,
        templateSha256: initialMapping.template_sha256?.substring(0, 16) + '...',
        currentMappingFields: mapping?.fields?.length || 0
      });
      setMapping(initialMapping);
      const filteredFields = (initialMapping.fields || []).filter((f: any) => f.id !== "ID_USER");
      console.log('🗺️ PdfMapper: Gefilterte Felder:', filteredFields.length, 'Felder');
      setFields(filteredFields);
      setIdx(0);
    } else if (initialMapping) {
      console.log('🗺️ PdfMapper: Mapping bereits geladen, überspringe');
    } else {
      console.log('🗺️ PdfMapper: Kein initialMapping vorhanden');
    }
  }, [initialMapping, mapping]);

  useEffect(() => {
    console.log('🔍 pdfDoc useEffect:', {
      hasPdfDoc: !!pdfDoc,
      hasCanvas: !!canvasRef.current,
      hasPdfjs: !!pdfjsRef.current,
      canvasWidth: canvasRef.current?.width,
      canvasHeight: canvasRef.current?.height
    });

    if (!pdfDoc) {
      console.log('⏳ Warte auf pdfDoc...');
      return;
    }

    // Prüfe ob Canvas vorhanden ist - mit Retry-Mechanismus
    if (!canvasRef.current) {
      console.log('⏳ Warte auf Canvas...');
      // Retry mit mehreren Versuchen
      let attempts = 0;
      const maxAttempts = 10;
      const checkCanvas = () => {
        attempts++;
        if (canvasRef.current) {
          console.log('✅ Canvas jetzt verfügbar nach', attempts, 'Versuchen');
          // Trigger erneut durch state update
          setPdfDoc(pdfDoc);
        } else if (attempts < maxAttempts) {
          setTimeout(checkCanvas, 100);
        } else {
          console.error('❌ Canvas nicht verfügbar nach', maxAttempts, 'Versuchen');
        }
      };
      setTimeout(checkCanvas, 100);
      return;
    }

    // Prüfe ob Canvas bereits eine Größe hat (wurde bereits gerendert)
    if (canvasRef.current.width === 0 && canvasRef.current.height === 0) {
      console.log('⏳ Canvas hat noch keine Größe, warte...');
      // Warte kurz und versuche erneut
      setTimeout(() => {
        if (pdfDoc && canvasRef.current) {
          setPdfDoc(pdfDoc);
        }
      }, 200);
      return;
    }

    // WICHTIG: Prüfe ob bereits ein Render-Vorgang läuft
    if (renderTaskRef.current) {
      console.log('⏳ Render-Vorgang läuft bereits, warte...');
      return;
    }

    (async () => {
      try {
        console.log('📄 Starte PDF-Rendering...');
        const p = await pdfDoc.getPage(1);
        setPage(p);
        const unscaled = p.getViewport({ scale: 1 });
        const available = Math.min(window.innerWidth - 360 - 80, 1200);
        const fit = Math.max(0.5, Math.min(2.5, available / unscaled.width));
        setScale(fit);
        console.log('📄 Rendering mit Scale:', fit, 'Viewport:', { width: unscaled.width, height: unscaled.height });
        await renderPage(p, fit);
        console.log('✅ PDF-Rendering abgeschlossen');
      } catch (err: any) {
        // Ignoriere Cancellation-Fehler
        if (err?.name === 'RenderingCancelledException' || err?.message?.includes('cancel')) {
          console.log('ℹ️ Render wurde abgebrochen (erwartet)');
          return;
        }
        console.error("❌ Render error", err);
      }
    })();
  }, [pdfDoc]);

  const renderPage = async (p: any, s: number) => {
    console.log('🎨 renderPage aufgerufen:', {
      hasCanvas: !!canvasRef.current,
      hasPage: !!p,
      scale: s,
      hasActiveTask: !!renderTaskRef.current
    });

    // WICHTIG: Breche vorherigen Render-Task ab, falls vorhanden
    if (renderTaskRef.current) {
      console.log('⚠️ Breche vorherigen Render-Task ab...');
      try {
        renderTaskRef.current.cancel();
      } catch (e) {
        // Ignoriere Fehler beim Abbrechen
      }
      renderTaskRef.current = null;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      console.error('❌ Canvas nicht vorhanden in renderPage!');
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error('❌ Canvas Context nicht verfügbar!');
      return;
    }

    const viewport = p.getViewport({ scale: s });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    console.log('🎨 Canvas-Dimensionen gesetzt:', {
      width: canvas.width,
      height: canvas.height,
      scale: s
    });

    try {
      const task = p.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task; // Speichere Task-Ref

      await task.promise;
      renderTaskRef.current = null; // Clear nach erfolgreichem Rendering
      console.log('✅ PDF auf Canvas gerendert');
    } catch (err: any) {
      renderTaskRef.current = null; // Clear auch bei Fehler
      // Ignoriere Cancellation-Fehler
      if (err?.name === 'RenderingCancelledException' || err?.message?.includes('cancel')) {
        console.log('ℹ️ Render-Task wurde abgebrochen (erwartet)');
        return;
      }
      console.error('❌ Fehler beim PDF-Rendering:', err);
      throw err;
    }

    // match overlay size - WICHTIG: Sowohl width/height als auch style.width/height setzen
    if (overlayRef.current) {
      overlayRef.current.width = canvas.width;
      overlayRef.current.height = canvas.height;
      overlayRef.current.style.width = `${canvas.width}px`;
      overlayRef.current.style.height = `${canvas.height}px`;
      console.log('✅ Overlay-Dimensionen angepasst:', { width: canvas.width, height: canvas.height });
    } else {
      console.warn('⚠️ Overlay-Ref nicht vorhanden');
    }

    drawOverlay();
    console.log('✅ Overlay gezeichnet');
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
      const step = gridSize;
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
      const isConfirmed = confirmedFields.has(i);
      const isCurrent = i === idx;

      if ((f as any).type === "boolean_pair") {
        const bp = f as any;
        if (bp.x_true != null && bp.y_true != null) {
          const cx = Math.round(bp.x_true);
          const cy = Math.round(ol.height - bp.y_true);
          const dotColor = isCurrent ? colActive : (isConfirmed ? colTrue : colTrue);
          drawDot(octx, cx, cy, dotColor);
          if (showIds) drawTag(octx, cx, cy, `${bp.id}: Ja${isConfirmed ? ' ✓' : ''}`);
        }
        if (bp.x_false != null && bp.y_false != null) {
          const cx = Math.round(bp.x_false);
          const cy = Math.round(ol.height - bp.y_false);
          const dotColor = isCurrent ? colActive : (isConfirmed ? colFalse : colFalse);
          drawDot(octx, cx, cy, dotColor);
          if (showIds) drawTag(octx, cx, cy, `${bp.id}: Nein${isConfirmed ? ' ✓' : ''}`);
        }
      } else {
        const t = f as any;
        const isCheckbox = t.type === 'checkbox';
        if (t.x != null && t.y != null) {
          const cx = Math.round(t.x);
          const cy = Math.round(ol.height - t.y);
          const dotColor = isCurrent ? colActive : (isConfirmed ? '#10b981' : (isCheckbox ? '#9333ea' : colPlaced)); // Lila für Checkbox

          // Checkbox mit Symbol rendern
          if (isCheckbox) {
            octx.save();
            const checkboxSize = Math.max(12, Math.round(12 * scale));
            const checkboxX = cx - checkboxSize / 2;
            const checkboxY = cy - checkboxSize / 2;

            // Kästchen-Rahmen
            octx.strokeStyle = dotColor;
            octx.lineWidth = 2;
            octx.strokeRect(checkboxX, checkboxY, checkboxSize, checkboxSize);

            // Wenn aktiv, X oder Haken zeigen (basierend auf Preview-Daten)
            const val = (previewData as any)?.[t.id];
            const isChecked = val === true || val === 'true' || val === '1' || String(val).toLowerCase() === 'ja';
            if (isChecked && showValues) {
              octx.strokeStyle = dotColor;
              octx.lineWidth = 2;
              // X zeichnen
              octx.beginPath();
              octx.moveTo(checkboxX + 2, checkboxY + 2);
              octx.lineTo(checkboxX + checkboxSize - 2, checkboxY + checkboxSize - 2);
              octx.moveTo(checkboxX + checkboxSize - 2, checkboxY + 2);
              octx.lineTo(checkboxX + 2, checkboxY + checkboxSize - 2);
              octx.stroke();
            }

            octx.restore();
            if (showIds) drawTag(octx, cx, cy + checkboxSize/2 + 4, `${t.id}${isConfirmed ? ' ✓' : ''}`);
          } else {
            // Normales Text-Feld
            drawDot(octx, cx, cy, dotColor);
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
              drawTag(octx, cx, cy, `${t.id}${isConfirmed ? ' ✓' : ''}`);
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
      }
    });
  };

  // Enter-Taste: Bestätigt aktuelle Platzierung und springt zum nächsten Feld
  const confirmAndAdvance = () => {
    if (!current) return;
    const f = current as any;
    const isPlaced = f.type === 'boolean_pair'
      ? (f.x_true != null && f.y_true != null && f.x_false != null && f.y_false != null)
      : (f.type === 'checkbox' || f.type === 'text' || f.type === 'date_de')
      ? (f.x != null && f.y != null)
      : (f.x != null && f.y != null);

    if (isPlaced) {
      // Feld als bestätigt markieren
      setConfirmedFields(prev => new Set(prev).add(idx));
      // Zum nächsten nicht-platzierten Feld springen
      let nextIdx = idx;
      for (let i = idx + 1; i < fields.length; i++) {
        const nextField = fields[i] as any;
        const nextPlaced = nextField.type === 'boolean_pair'
          ? (nextField.x_true == null || nextField.y_true == null || nextField.x_false == null || nextField.y_false == null)
          : (nextField.x == null || nextField.y == null);
        if (nextPlaced) {
          nextIdx = i;
          break;
        }
      }
      if (nextIdx !== idx) {
        setIdx(nextIdx);
        setAwaitingFalse(false);
      } else {
        // Alle Felder platziert, zum nächsten unbestätigten
        for (let i = idx + 1; i < fields.length; i++) {
          if (!confirmedFields.has(i)) {
            setIdx(i);
            setAwaitingFalse(false);
            return;
          }
        }
      }
    }
  };

  // Keyboard nudging: arrows move current field, Shift = 5pt, Enter = bestätigen & weiter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current) return;

      // Enter-Taste: Bestätigen und weiter
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        confirmAndAdvance();
        return;
      }

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
        // Bestätigung entfernen wenn verschoben
        setConfirmedFields(prev => {
          const next = new Set(prev);
          next.delete(idx);
          return next;
        });
        drawOverlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fields, idx, current, confirmedFields, confirmAndAdvance]);

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

  // SHA-256 Hash berechnen (client-side)
  const calculateSHA256 = async (buffer: ArrayBuffer): Promise<string> => {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const onPdfFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async function () {
      const typedarray = new Uint8Array(this.result as ArrayBuffer);
      setPdfBuffer(this.result as ArrayBuffer);
      setPdfFileName(file.name);

      // Hash berechnen
      try {
        const hash = await calculateSHA256(this.result as ArrayBuffer);
        setPdfHash(hash);
        console.log(`PDF Hash: ${hash}`);
      } catch (e) {
        console.error('Hash-Berechnung fehlgeschlagen:', e);
      }

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
      if (t === 'checkbox') {
        if (f.x == null || f.y == null) continue;
        const val = values[f.id];
        const isChecked = val === true || val === 'true' || val === 1 || String(val).toLowerCase() === 'ja';
        // Checkbox rendert stamp_pdf.py mit ☒ oder ☐, hier verwenden wir X
        if (isChecked) {
          page.drawText('X', { x: f.x, y: f.y - mapFontSize, size: mapFontSize, font: helv, color: rgb(0,0,0) });
        }
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
    if (!current || !page) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const base = overlayRef.current || (e.target as HTMLCanvasElement);
    const px = Math.round(e.clientX - rect.left);
    const py = Math.round(e.clientY - rect.top);
    const h = (base as HTMLCanvasElement).height;
    let x = px;
    let y = h - py; // PDF-Koordinaten (unten-links)
    if (snap && snap > 1) { x = Math.round(x / snap) * snap; y = Math.round(y / snap) * snap; }

    // Prüfe ob man auf einen bereits platzierten Marker klickt (Hit-Test)
    const cur = current as any;
    let isClickingOnMarker = false;
    const markerRadius = cur.type === 'checkbox' ? 20 : 12; // Größerer Radius für Checkbox-Kästchen

    if (cur.type === 'boolean_pair') {
      if (cur.x_true != null && cur.y_true != null) {
        const cx = cur.x_true, cy = h - cur.y_true;
        if (Math.hypot(px - cx, py - cy) <= markerRadius) {
          isClickingOnMarker = true;
        }
      }
      if (cur.x_false != null && cur.y_false != null) {
        const cx = cur.x_false, cy = h - cur.y_false;
        if (Math.hypot(px - cx, py - cy) <= markerRadius) {
          isClickingOnMarker = true;
        }
      }
    } else if (cur.x != null && cur.y != null) {
      const cx = cur.x, cy = h - cur.y;
      if (cur.type === 'checkbox') {
        // Checkbox: Prüfe ob Klick im Kästchen-Bereich
        const checkboxSize = 12 * scale;
        const checkboxX = cx - checkboxSize / 2;
        const checkboxY = cy - checkboxSize / 2;
        if (px >= checkboxX && px <= checkboxX + checkboxSize && py >= checkboxY && py <= checkboxY + checkboxSize) {
          isClickingOnMarker = true;
        }
      } else {
        if (Math.hypot(px - cx, py - cy) <= markerRadius) {
          isClickingOnMarker = true;
        }
      }
    }

    const copy = [...fields] as any[];
    const f = { ...(copy[idx] as any) };
    const wasNotPlaced = f.type === "boolean_pair"
      ? (f.x_true == null || f.y_true == null || f.x_false == null || f.y_false == null)
      : (f.type === "checkbox" || f.type === "text" || f.type === "date_de")
      ? (f.x == null || f.y == null)
      : (f.x == null || f.y == null);

    if (f.type === "boolean_pair") {
      if (f.x_true == null || f.y_true == null) {
        f.x_true = x; f.y_true = y; setAwaitingFalse(true);
      } else if (awaitingFalse || f.x_false == null || f.y_false == null) {
        f.x_false = x; f.y_false = y; setAwaitingFalse(false);
        // Auto-Advance nur wenn komplett neu platziert
        if (autoAdvance && wasNotPlaced) setIdx(Math.min(idx + 1, fields.length - 1));
      } else if (isClickingOnMarker) {
        // Auf Marker geklickt -> Position aktualisieren, aber kein Auto-Advance
        // (wird durch Drag gemacht, aber hier als Fallback)
        f.x_true = x; f.y_true = y;
      }
    } else {
      f.x = x; f.y = y;
      // Kein Auto-Advance mehr - Platzierung wird durch Enter bestätigt
      // Wenn Feld neu platziert wurde, Bestätigung entfernen
      if (wasNotPlaced) {
        setConfirmedFields(prev => {
          const next = new Set(prev);
          next.delete(idx);
          return next;
        });
      }
    }
    copy[idx] = f as any;
    setFields(copy as any);
    drawOverlay();
  };

  const usePreviousY = () => {
    if (idx > 0 && current) {
      const prev = fields[idx - 1] as any;
      const curr = current as any;
      if (prev.y != null && curr.type !== 'boolean_pair' && (curr.type === 'text' || curr.type === 'checkbox' || curr.type === 'date_de')) {
        const copy = [...fields] as any[];
        copy[idx] = { ...curr, y: prev.y };
        setFields(copy);
        drawOverlay();
      }
    }
  };

  const saveMapping = () => {
    if (!mapping) return;
    const out = { ...mapping, fields };

    // Template-Info automatisch ergänzen wenn PDF geladen wurde
    if (pdfHash) {
      out.template_sha256 = pdfHash;
    }
    if (pdfFileName) {
      // Template-Quelle dokumentieren (Dateiname, nicht Pfad)
      const fileName = pdfFileName.split(/[/\\]/).pop() || pdfFileName;
      out.template_source = fileName;
      // Optional: template-Feld entfernen wenn vorhanden (nicht mehr nötig)
      if (out.template) {
        // Template-Feld nur behalten wenn es nicht "template.pdf" ist (für Kompatibilität)
        if (out.template === 'template.pdf') {
          delete out.template;
        }
      }
    }

    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mapping_updated.json";
    a.click();
  };

  const exportToTemplateSystem = () => {
    if (!mapping || !pdfFileName) {
      alert("Bitte zuerst PDF und Mapping laden.");
      return;
    }
    setShowExportDialog(true);
  };

  const copyExportCommands = () => {
    const basePath = "C:\\pa\\07-dev-play\\11_dev-formulare";
    const templateDir = `${basePath}\\21-Template-System\\templates\\${exportTemplateId}`;

    const commands = [
      `# PowerShell-Befehle zum Export:`,
      `$templateDir = "${templateDir}"`,
      `New-Item -ItemType Directory -Force -Path $templateDir`,
      ``,
      `# Mapping kopieren (aus Download-Ordner)`,
      `Copy-Item -Path "$env:USERPROFILE\\Downloads\\mapping_updated.json" -Destination "$templateDir\\mapping.json" -Force`,
      ``,
      `# Template-PDF kopieren (falls noch nicht vorhanden)`,
      `# Kopiere: ${pdfFileName} → $templateDir\\template.pdf`,
      ``,
      `Write-Host "✅ Export abgeschlossen!" -ForegroundColor Green`,
    ].join("\n");

    navigator.clipboard.writeText(commands).then(() => {
      alert("PowerShell-Befehle in Zwischenablage kopiert! Paste in PowerShell.");
    });
  };

  const zoomChanged = async (val: number) => {
    console.log('🔍 Zoom geändert:', { alt: scale, neu: val });
    setScale(val);
    if (page && !renderTaskRef.current) {
      console.log('📄 Rendere PDF mit neuem Zoom:', val);
      await renderPage(page, val);
    } else if (renderTaskRef.current) {
      console.log('⏳ Render-Vorgang läuft bereits, überspringe Zoom');
    } else if (!page) {
      console.warn('⚠️ Keine Page verfügbar für Zoom');
    }
  };

  useEffect(() => { drawOverlay(); }, [fields, idx, scale, page, gridSize, confirmedFields]);

  return (
    <div className="grid grid-cols-[320px_1fr_300px] h-full overflow-hidden">
      <aside className="border-r border-slate-200 p-3 space-y-3 overflow-y-auto">
        <h3 className="font-semibold">Mapping platzieren</h3>
          <div className="well text-xs leading-5">
          1) PDF laden • 2) Mapping laden • 3) Feld wählen • 4) In PDF klicken • 5) Enter = Bestätigen & Weiter. Bei Ja/Nein-Feldern zweimal klicken (Ja, dann Nein). Checkboxen: Einmal klicken auf Kästchen-Mitte. Markierungen sind verschiebbar: Marker anklicken und ziehen.
        </div>
        <div className="flex gap-2 text-sm">
          <button className="px-2 py-1 border rounded" onClick={()=>{ document.body.classList.remove('theme-light','theme-graphite'); drawOverlay(); }}>Dark</button>
          <button className="px-2 py-1 border rounded" onClick={()=>{ document.body.classList.add('theme-light'); document.body.classList.remove('theme-graphite'); drawOverlay(); }}>Light</button>
          <button className="px-2 py-1 border rounded" onClick={()=>{ document.body.classList.add('theme-graphite'); document.body.classList.remove('theme-light'); drawOverlay(); }}>Graphit</button>
        </div>

        <div className="flex gap-2 text-sm">
          <button className={`px-2 py-1 border border-gray-600 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 ${placingMode?'brightness-110':''}`} onClick={()=> setPlacingMode(true)}>Platzieren</button>
          <button className="px-2 py-1 border border-gray-600 rounded bg-gray-700 text-gray-200 hover:bg-gray-600" onClick={()=> setPlacingMode(false)}>Bestätigen</button>
          <button className="px-2 py-1 border border-gray-600 rounded bg-gray-700 text-gray-200 hover:bg-gray-600" onClick={()=> { setPlacingMode(false); }}>Abbrechen</button>
        </div>
        <div className="flex gap-2 text-xs flex-wrap">
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={autoAdvance} onChange={e=>setAutoAdvance(e.target.checked)} /> Auto‑Weiter</label>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={showGrid} onChange={e=>{ setShowGrid(e.target.checked); drawOverlay(); }} /> Raster</label>
          <label className="inline-flex items-center gap-1">Grid
            <select value={gridSize} onChange={e=>{ const v=parseInt(e.target.value); setGridSize(v); drawOverlay(); }}>
              <option value={5}>5px</option>
              <option value={10}>10px</option>
              <option value={20}>20px</option>
              <option value={50}>50px</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-1">Snap
            <select value={snap} onChange={e=>{ const v=parseInt(e.target.value); setSnap(v); }}>
              <option value={1}>aus</option>
              <option value={5}>5px</option>
              <option value={10}>10px</option>
              <option value={25}>25px</option>
            </select>
          </label>
        </div>

        {/* File-Inputs nur anzeigen wenn keine Props übergeben wurden */}
        {!initialPdf && (
          <div>
            <label className="block text-sm mb-1">PDF laden (Template)</label>
            <input type="file" accept="application/pdf" onChange={(e)=>{ const f=e.target.files?.[0]; if (f) onPdfFile(f); }} />
            {pdfFileName && (
              <div className="mt-1 text-xs text-gray-600">
                ✓ {pdfFileName}
                {pdfHash && <div className="text-xs text-gray-500 mt-0.5">Hash: {pdfHash.slice(0, 16)}...</div>}
              </div>
            )}
          </div>
        )}
        {initialPdf && (
          <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-2">
            <div className="text-xs text-blue-800">
              ✓ PDF geladen: <strong>{initialPdf.name}</strong>
            </div>
            {pdfHash && (
              <div className="text-xs text-blue-600 mt-1">
                Hash: <code className="text-xs">{pdfHash.substring(0, 16)}...</code>
              </div>
            )}
          </div>
        )}
        {!initialMapping && (
          <div>
            <label className="block text-sm mb-1">Mapping laden (JSON)</label>
            <input type="file" accept="application/json" onChange={(e)=>{ const f=e.target.files?.[0]; if (f) onMapFile(f); }} />
          </div>
        )}
        {initialMapping && (
          <div className="bg-green-50 border border-green-200 rounded p-2 mb-2">
            <div className="text-xs text-green-800">
              ✓ Mapping geladen: <strong>{initialMapping.fields?.length || 0} Felder</strong>
            </div>
            {initialMapping.template_sha256 && (
              <div className="text-xs text-green-600 mt-1">
                Template-Hash: <code className="text-xs">{initialMapping.template_sha256.substring(0, 16)}...</code>
              </div>
            )}
          </div>
        )}

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
                : ((f as any).type === 'checkbox' || (f as any).type === 'text' || (f as any).type === 'date_de' || !(f as any).type)
                ? (f as any).x != null && (f as any).y != null
                : (f as any).x != null && (f as any).y != null;
              const confirmed = confirmedFields.has(i);
              return (
                <button key={(f as any).id}
                  className={`w-full text-left px-2 py-1 text-sm border-b last:border-0 hover:brightness-110 ${i===idx? 'brightness-110' : ''}`}
                  onClick={()=>{ setIdx(i); setAwaitingFalse(false); }}>
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-2"
                    style={{
                      backgroundColor: confirmed ? '#10b981' : (placed ? 'var(--color-status-success)' : 'var(--color-border-primary)')
                    }}
                  />
                  {(f as any).id}{confirmed ? ' ✓' : ''}
                </button>
              );
            })}
          </div>
        </div>

        {/* Duplikate entfernt: Navigation, Feldinfo, Speichern, Zoom, Koordinate sind nur rechts sichtbar. */}
      </aside>

      <main className="app-main overflow-y-auto overflow-x-auto bg-gray-100">
        <div className="pdf-frame min-h-full flex items-center justify-center p-4">
          {fallbackUrl ? (
            <embed src={`${fallbackUrl}#zoom=page-width`} type="application/pdf" className="w-[900px] h-[1200px]" />
          ) : (
            <div className="relative inline-block">
              <canvas ref={canvasRef} className="block" />
              <canvas
                ref={overlayRef}
                className="absolute top-0 left-0 cursor-crosshair"
                style={{
                  width: canvasRef.current?.width || 0,
                  height: canvasRef.current?.height || 0
                }}
                onClick={onCanvasClick}
                onMouseDown={(e)=>{
                  if (!overlayRef.current) return;
                  // hit-test current field markers for drag
                  const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
                  const px = Math.round(e.clientX - rect.left);
                  const py = Math.round(e.clientY - rect.top);
                  const radius = 12; // Größerer Radius für einfacheres Greifen
                  const h = (e.target as HTMLCanvasElement).height;
                  const cur = fields[idx] as any;
                  if (!cur) return;
                  if (cur.type === 'boolean_pair') {
                    if (cur.x_true != null && cur.y_true != null) {
                      const cx = cur.x_true, cy = h - cur.y_true;
                      if (Math.hypot(px-cx, py-cy) <= radius) {
                        e.preventDefault(); // Verhindere onClick
                        setDrag({kind:'bp_true', i: idx});
                        return;
                      }
                    }
                    if (cur.x_false != null && cur.y_false != null) {
                      const cx = cur.x_false, cy = h - cur.y_false;
                      if (Math.hypot(px-cx, py-cy) <= radius) {
                        e.preventDefault();
                        setDrag({kind:'bp_false', i: idx});
                        return;
                      }
                    }
                  } else if (cur.x != null && cur.y != null) {
                    const cx = cur.x, cy = h - cur.y;
                    if (cur.type === 'checkbox') {
                      // Checkbox: Prüfe ob Klick im Kästchen-Bereich
                      const checkboxSize = 12 * scale;
                      const checkboxX = cx - checkboxSize / 2;
                      const checkboxY = cy - checkboxSize / 2;
                      if (px >= checkboxX && px <= checkboxX + checkboxSize && py >= checkboxY && py <= checkboxY + checkboxSize) {
                        e.preventDefault();
                        setDrag({kind:'text', i: idx}); // Verwende 'text' für Drag
                        return;
                      }
                    } else {
                      if (Math.hypot(px-cx, py-cy) <= radius) {
                        e.preventDefault();
                        setDrag({kind:'text', i: idx});
                        return;
                      }
                    }
                    // hit test width handle if exists (nur für Text-Felder mit Breite)
                    if (cur.w && cur.type !== 'checkbox') {
                      const hx = cx + Math.round(cur.w);
                      const hy = h - (cur.y + Math.round((cur.size ?? mapping?.size ?? 12)/2));
                      if (Math.abs(px - hx) <= 6 && Math.abs(py - hy) <= Math.max(10, Math.round(10*scale))) {
                        e.preventDefault();
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
            </div>
          )}
        </div>
      </main>
      {/* Right tool rail */}
      <aside className="border-l border-slate-200 p-3 space-y-3 overflow-y-auto">
        <div>
            {/* Duplikate entfernt - Buttons sind bereits im linken Panel */}
            <div className="text-sm">
              <div>Feld: <span className="font-medium">{current?.id ?? "–"}</span>
                <span className="ml-2 inline-block text-xs px-2 py-0.5 rounded border">{displayType(current)}</span>
                {confirmedFields.has(idx) && <span className="ml-2 text-green-600">✓ Bestätigt</span>}
              </div>
              <div className="mt-1 text-xs text-gray-600">
                Enter = Bestätigen & Weiter
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
            {current && (current as any).type !== 'boolean_pair' && ((current as any).type === 'text' || (current as any).type === 'checkbox' || (current as any).type === 'date_de') && (
              <button className="px-2 py-1 border rounded w-full text-xs" onClick={usePreviousY} title="Y-Koordinate vom vorherigen Feld übernehmen">
                Y vom vorherigen Feld
              </button>
            )}
            <button className="px-3 py-1.5 border rounded w-full" onClick={saveMapping} disabled={!pdfHash}>
              Speichern {pdfHash ? '✓' : '(PDF-Hash wird automatisch eingefügt)'}
            </button>
            {pdfHash && (
              <div className="text-xs text-gray-600 mt-1">
                Template-Hash wird beim Speichern automatisch ergänzt
              </div>
            )}
            {onExport && (
              <button
                className="px-3 py-1.5 border rounded w-full bg-blue-50 hover:bg-blue-100"
                onClick={() => {
                  if (onMappingComplete && mapping) {
                    const updatedMapping = { ...mapping, fields };
                    onMappingComplete(updatedMapping);
                  }
                  onExport();
                }}
                disabled={!pdfHash || !mapping}
              >
                ➡️ Weiter zu Export
              </button>
            )}
            <button className="px-3 py-1.5 border rounded w-full bg-blue-50 hover:bg-blue-100" onClick={exportToTemplateSystem} disabled={!pdfHash || !mapping}>
              📤 Export nach Template-System
            </button>
            <button className="px-3 py-1.5 border rounded w-full" onClick={renderTestPdf} title="Erzeugt ein Test-PDF mit den Demo-Daten">Test‑PDF erstellen</button>
            <div>
              <label className="block text-sm mb-1">Zoom: {(scale * 100).toFixed(0)}%</label>
              <input
                type="range"
                min={0.5}
                max={2.5}
                value={scale}
                step={0.1}
                onChange={(e)=>zoomChanged(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            <div className="text-sm">Koordinate: <code>{hoverXY ? `x=${hoverXY.x}, y=${hoverXY.y}` : '-'}</code></div>
          </div>
      </aside>
      {/* Export-Dialog */}
      {showExportDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-2xl w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">📤 Export nach Template-System</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Template-ID:</label>
                <input
                  type="text"
                  value={exportTemplateId}
                  onChange={(e) => setExportTemplateId(e.target.value)}
                  className="w-full px-3 py-2 border rounded"
                  placeholder="z.B. 034122-spendenbescheinigung-geld"
                />
              </div>
              <div className="bg-gray-50 p-4 rounded text-sm">
                <p className="font-medium mb-2">📋 Ablauf:</p>
                <ol className="list-decimal list-inside space-y-1 text-gray-700">
                  <li>Klicke auf "Speichern" (falls noch nicht geschehen) → Download: <code className="bg-gray-200 px-1 rounded">mapping_updated.json</code></li>
                  <li>Klicke auf "Befehle kopieren" → PowerShell-Befehle in Zwischenablage</li>
                  <li>Öffne PowerShell und führe die Befehle aus</li>
                </ol>
              </div>
              <div className="bg-blue-50 p-4 rounded text-sm">
                <p className="font-medium mb-2">📍 Ziel-Ordner:</p>
                <code className="text-xs bg-white p-2 rounded block">
                  C:\pa\07-dev-play\11_dev-formulare\21-Template-System\templates\{exportTemplateId}\
                </code>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={copyExportCommands}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  📋 Befehle kopieren
                </button>
                <button
                  onClick={() => setShowExportDialog(false)}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Schließen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import PdfMapper from "./PdfMapper";
import FormularAuswahlNeu from "./FormularAuswahlNeu";
import { generateFileName } from "../lib/filename-helper";

type Step = 1 | 2 | 3;

type Mapping = {
  template?: string;
  template_sha256?: string;
  template_source?: string;
  font?: string;
  size?: number;
  status?: string;
  fields: any[];
};

export default function WizardSteps() {
  const [step, setStep] = useState<Step>(1);
  const [formularId, setFormularId] = useState<string>("");
  const [kategorie, setKategorie] = useState<string>("steuern/spenden");
  const [blankPdf, setBlankPdf] = useState<File | null>(null);
  const [filledPdf, setFilledPdf] = useState<File | null>(null);
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isNewFormular, setIsNewFormular] = useState(false);

  // Vorhandene Dateien
  const [existingFiles, setExistingFiles] = useState<{
    tpl: { exists: boolean; name?: string };
    demo: { exists: boolean; name?: string };
    demoXml: { exists: boolean; name?: string };
  } | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const handleAutoMap = async () => {
    if (!formularId) {
      setError("Bitte ein Formular auswählen oder neu erstellen!");
      return;
    }

    // Für bestehende Formulare: Prüfe ob Dateien vorhanden sind oder hochgeladen wurden
    if (!isNewFormular) {
      const hasTpl = existingFiles?.tpl.exists || blankPdf;
      const hasDemo = existingFiles?.demo.exists || filledPdf;
      const hasXml = existingFiles?.demoXml.exists || xmlFile;

      if (!hasTpl || !hasDemo || !hasXml) {
        setError("Bitte alle drei Dateien bereitstellen (entweder vorhanden oder neu hochladen)!");
        return;
      }
    } else {
      // Für neue Formulare: Alle müssen hochgeladen werden
      if (!blankPdf || !filledPdf || !xmlFile) {
        setError("Bitte alle drei Dateien auswählen!");
        return;
      }
    }

    setIsProcessing(true);
    setError(null);
    setProgress("Analysiere Dateien...");

    try {
      // Wenn neues Formular: Zuerst erstellen
      if (isNewFormular) {
        setProgress("Erstelle Formular-Ordnerstruktur...");
        const createFormData = new FormData();
        createFormData.append("formularId", formularId);
        createFormData.append("kategorie", kategorie);
        createFormData.append("blankPdf", blankPdf);
        createFormData.append("filledPdf", filledPdf);
        createFormData.append("xmlFile", xmlFile);

        const createResponse = await fetch("/api/create-formular", {
          method: "POST",
          body: createFormData,
        });

        if (!createResponse.ok) {
          const createError = await createResponse.json();
          throw new Error(createError.error || "Fehler beim Erstellen des Formulars");
        }

        setProgress("Formular erstellt - starte Auto-Mapping...");
      }

      // Auto-Mapping durchführen
      // Für bestehende Formulare: Verwende vorhandene Dateien oder hochgeladene
      const formData = new FormData();

      if (!isNewFormular && existingFiles) {
        // Prüfe ob alle Dateien vorhanden sind oder hochgeladen wurden
        const needsExisting = (existingFiles.tpl.exists && !blankPdf) ||
                             (existingFiles.demo.exists && !filledPdf) ||
                             (existingFiles.demoXml.exists && !xmlFile);

        if (needsExisting) {
          formData.append("useExisting", "true");
          formData.append("formularId", formularId);
          formData.append("kategorie", kategorie);
        }

        // Füge hochgeladene Dateien hinzu (falls vorhanden)
        if (blankPdf) formData.append("blankPdf", blankPdf);
        if (filledPdf) formData.append("filledPdf", filledPdf);
        if (xmlFile) formData.append("xmlFile", xmlFile);
      } else {
        // Für neue Formulare: Alle müssen hochgeladen sein
        formData.append("blankPdf", blankPdf!);
        formData.append("filledPdf", filledPdf!);
        formData.append("xmlFile", xmlFile!);
      }

      setProgress("Führe Auto-Mapping aus...");
      console.log("🚀 Starte Auto-Mapping...", { formularId, kategorie, hasBlankPdf: !!blankPdf, hasFilledPdf: !!filledPdf, hasXml: !!xmlFile });

      const response = await fetch("/api/automap", {
        method: "POST",
        body: formData,
      });

      console.log("📡 API Response Status:", response.status);

      const result = await response.json();
      console.log("📦 API Result:", { success: result.success, fieldsCount: result.fieldsCount, hasMapping: !!result.mapping });

      if (!response.ok) {
        console.error("❌ Auto-Mapping Fehler:", result.error);
        throw new Error(result.error || "Auto-Mapping fehlgeschlagen");
      }

      if (!result.mapping) {
        console.error("❌ Kein Mapping in Response:", result);
        throw new Error("Mapping ist leer - keine Felder gefunden");
      }

      setProgress("Mapping erfolgreich erstellt!");

      // Mapping speichern
      setProgress("Speichere Mapping...");
      const saveResponse = await fetch("/api/save-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formularId,
          kategorie,
          mapping: result.mapping,
          version: "auto-generated"
        }),
      });

      if (!saveResponse.ok) {
        console.warn("⚠️ Mapping konnte nicht gespeichert werden, aber weiter mit Mapping im Speicher");
      } else {
        console.log("✅ Mapping gespeichert");
      }

      console.log("💾 Setze Mapping State:", {
        fieldsCount: result.mapping.fields?.length || 0,
        mappingKeys: Object.keys(result.mapping),
        firstField: result.mapping.fields?.[0]
      });

      // Prüfe Mapping-Struktur
      if (!result.mapping || typeof result.mapping !== 'object') {
        console.error("❌ Mapping ist kein Objekt:", typeof result.mapping, result.mapping);
        throw new Error("Mapping-Struktur ungültig");
      }

      if (!Array.isArray(result.mapping.fields)) {
        console.error("❌ Mapping.fields ist kein Array:", result.mapping.fields);
        throw new Error("Mapping.fields muss ein Array sein");
      }

      setMapping(result.mapping);
      console.log("✅ Mapping State gesetzt");
      setIsNewFormular(false); // Reset nach erfolgreichem Mapping

      // Prüfe ob blankPdf vorhanden ist, bevor zu Schritt 2 gewechselt wird
      if (!blankPdf) {
        console.error("❌ blankPdf fehlt beim Wechsel zu Schritt 2");
        setError("PDF-Datei fehlt! Bitte zuerst leeres PDF laden.");
        setIsProcessing(false);
        return;
      }

      console.log("✅ Auto-Mapping erfolgreich:", {
        hasMapping: !!result.mapping,
        mappingFields: result.mapping?.fields?.length || 0,
        hasBlankPdf: !!blankPdf,
        blankPdfName: blankPdf?.name,
        blankPdfSize: blankPdf?.size,
        blankPdfType: blankPdf?.type,
        isFileInstance: blankPdf instanceof File
      });

      // DEBUG: Prüfe ob alles korrekt ist
      if (!result.mapping || !result.mapping.fields || result.mapping.fields.length === 0) {
        console.error("❌ Mapping ungültig oder leer:", result.mapping);
        setError("Mapping ist ungültig - keine Felder gefunden!");
        setIsProcessing(false);
        return;
      }

      if (!blankPdf || !(blankPdf instanceof File)) {
        console.error("❌ blankPdf ungültig:", blankPdf);
        setError("PDF-Datei ist ungültig!");
        setIsProcessing(false);
        return;
      }

      // Zeige Debug-Info für User
      console.log("✅ ALLE CHECKS BESTANDEN - Wechsle zu Schritt 2");
      console.log("📊 Mapping-Details:", {
        fieldsCount: result.mapping.fields.length,
        fieldIds: result.mapping.fields.slice(0, 5).map((f: any) => f.id),
        templateSha256: result.mapping.template_sha256?.substring(0, 16) + '...'
      });
      console.log("📄 PDF-Details:", {
        name: blankPdf.name,
        size: blankPdf.size,
        type: blankPdf.type,
        lastModified: blankPdf.lastModified
      });

      // Sofort zu Schritt 2
      setStep(2);
      setIsProcessing(false);

    } catch (err: any) {
      setError(err.message || "Fehler beim Auto-Mapping");
      setIsProcessing(false);
      setProgress("");
    }
  };

  const handleMappingComplete = (updatedMapping: Mapping) => {
    setMapping(updatedMapping);
  };

  // Lade vorhandene Dateien wenn Formular ausgewählt wird
  const loadExistingFiles = async (id: string, kat: string) => {
    if (!id || !kat) return;

    setLoadingFiles(true);
    try {
      const response = await fetch(`/api/formulare/grundlagen?formularId=${encodeURIComponent(id)}&kategorie=${encodeURIComponent(kat)}`);
      const result = await response.json();

      if (result.success) {
        setExistingFiles(result.files);

        // Lade Dateien automatisch in die File-Inputs
        if (result.files.tpl.exists) {
          await loadFileIntoInput(id, kat, 'tpl', (file) => setBlankPdf(file));
        }
        if (result.files.demo.exists) {
          await loadFileIntoInput(id, kat, 'demo', (file) => setFilledPdf(file));
        }
        if (result.files.demoXml.exists) {
          await loadFileIntoInput(id, kat, 'demo-xml', (file) => setXmlFile(file));
        }
      }
    } catch (err) {
      console.error('Fehler beim Laden vorhandener Dateien:', err);
      setExistingFiles(null);
    } finally {
      setLoadingFiles(false);
    }
  };

  // Lädt eine Datei vom Server und konvertiert sie zu einem File-Objekt
  const loadFileIntoInput = async (
    formularId: string,
    kategorie: string,
    fileType: 'tpl' | 'demo' | 'demo-xml',
    setter: (file: File) => void
  ) => {
    try {
      const response = await fetch(
        `/api/formulare/grundlagen/download?formularId=${encodeURIComponent(formularId)}&kategorie=${encodeURIComponent(kategorie)}&type=${fileType}`
      );

      if (!response.ok) {
        console.warn(`Datei ${fileType} konnte nicht geladen werden`);
        return;
      }

      const blob = await response.blob();
      const fileName = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || `file.${fileType === 'demo-xml' ? 'xml' : 'pdf'}`;

      // Konvertiere Blob zu File-Objekt
      const file = new File([blob], fileName, {
        type: blob.type || (fileType === 'demo-xml' ? 'application/xml' : 'application/pdf')
      });

      setter(file);
    } catch (error) {
      console.error(`Fehler beim Laden von ${fileType}:`, error);
    }
  };

  // Wenn Formular ausgewählt wird, lade vorhandene Dateien
  useEffect(() => {
    if (formularId && kategorie && !isNewFormular) {
      loadExistingFiles(formularId, kategorie);
    } else {
      setExistingFiles(null);
    }
  }, [formularId, kategorie, isNewFormular]);

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      {/* Header mit Schritt-Anzeige */}
      <div className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-xl font-semibold text-gray-200">PDF-Mapping-Workflow</h1>
            <button
              onClick={async () => {
                const ssotPath = `C:\\pa\\07-dev-play\\11_dev-formulare\\20_PDF_erstellung\\PDF-mapping\\formulare`;
                try {
                  const response = await fetch('/api/open-folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: ssotPath })
                  });
                  if (!response.ok) {
                    await navigator.clipboard.writeText(ssotPath);
                    alert('Pfad kopiert! (Explorer konnte nicht geöffnet werden)');
                  }
                } catch (error) {
                  await navigator.clipboard.writeText(ssotPath);
                  alert('Pfad kopiert!');
                }
              }}
              className="px-3 py-1.5 text-sm bg-gray-700 text-gray-200 border border-gray-600 rounded hover:bg-gray-600 transition-colors flex items-center gap-2"
              title="SSOT-Ordner im Explorer öffnen"
            >
              <span>📁</span>
              <span>SSOT öffnen</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className={`px-4 py-2 rounded ${step >= 1 ? 'bg-gray-700 text-gray-200 border border-gray-600' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}>
              1. Auto-Mapping
            </div>
            <div className={`w-8 h-1 ${step >= 2 ? 'bg-gray-600' : 'bg-gray-700'}`}></div>
            <div className={`px-4 py-2 rounded ${step >= 2 ? 'bg-gray-700 text-gray-200 border border-gray-600' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}>
              2. Anpassung
            </div>
            <div className={`w-8 h-1 ${step >= 3 ? 'bg-gray-600' : 'bg-gray-700'}`}></div>
            <div className={`px-4 py-2 rounded ${step >= 3 ? 'bg-gray-700 text-gray-200 border border-gray-600' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}>
              3. Export
            </div>
          </div>
        </div>
      </div>

      {/* Schritt-Inhalt */}
      <div className="flex-1 overflow-auto bg-gray-900">
        {step === 1 && (
          <div className="max-w-4xl mx-auto p-8">
            <h2 className="text-2xl font-semibold mb-6 text-gray-200">Schritt 1/3: Auto-Mapping</h2>
            <p className="text-sm text-gray-400 mb-6">
              <strong>Was passiert hier?</strong> Sie wählen ein bestehendes Formular aus (oder erstellen ein neues)
              und erstellen dann ein Mapping dafür. Das Mapping definiert, wo Daten im PDF platziert werden.
            </p>

            <div className="space-y-6">
              {/* Formular-Auswahl oder Neu */}
              <div className="border border-gray-700 rounded-lg p-4 bg-gray-800">
                <FormularAuswahlNeu
                  initialFormularId={formularId}
                  onSelect={(id, kat) => {
                    setFormularId(id);
                    setKategorie(kat);
                    setIsNewFormular(false);
                  }}
                  onNew={(id, kat) => {
                    setFormularId(id);
                    setKategorie(kat);
                    setIsNewFormular(true);
                  }}
                />
                {formularId && (
                  <div className="mt-4 p-3 bg-gray-700 border border-gray-600 rounded">
                    <div className="text-sm font-medium text-gray-200">
                      Ausgewählt: <span className="font-mono text-gray-100">{formularId}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      Kategorie: {kategorie}
                    </div>
                  </div>
                )}
              </div>

              {/* File-Upload - nur wenn Formular ausgewählt */}
              {formularId && (
                <div className="space-y-4">
                  {isNewFormular ? (
                    // Für neue Formulare: Einfacher Hinweis und kombiniertes Upload
                    <div className="bg-gray-800 border border-gray-700 rounded p-4">
                      <div className="bg-blue-900/20 border border-blue-700 rounded p-3 mb-4">
                        <p className="text-sm font-semibold text-blue-200 mb-2">
                          📋 Benötigte Dateien für Auto-Mapping:
                        </p>
                        <div className="space-y-3 text-sm">
                          <div className="bg-gray-800 border border-gray-600 rounded p-2">
                            <div className="font-medium text-gray-200">1. Template PDF (leer)</div>
                            <div className="text-xs text-gray-400 mt-1">
                              Das leere PDF-Formular mit Checkboxen. Dient als Vorlage für das Mapping.
                            </div>
                          </div>
                          <div className="bg-gray-800 border border-gray-600 rounded p-2">
                            <div className="font-medium text-gray-200">2. Beispiel PDF (ausgefüllt)</div>
                            <div className="text-xs text-gray-400 mt-1">
                              Das gleiche PDF, aber mit Beispiel-Daten ausgefüllt. Wird mit dem Template verglichen, um Felder automatisch zu finden.
                            </div>
                          </div>
                          <div className="bg-gray-800 border border-gray-600 rounded p-2">
                            <div className="font-medium text-gray-200">3. Beispiel XML (mit Daten)</div>
                            <div className="text-xs text-gray-400 mt-1">
                              XML-Datei mit Beispiel-Daten im gleichen Format wie später verwendet. Enthält Feldnamen und Werte für das Mapping.
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="bg-gray-700 border border-gray-600 rounded p-3 mb-4">
                        <p className="text-xs text-gray-400 mb-2">
                          <strong>📁 Vollständiger Windows-Pfad (wo die Dateien gespeichert werden):</strong>
                        </p>
                        <div className="flex items-center gap-2 mb-2">
                          <p
                            className="text-xs text-gray-200 font-mono break-all bg-gray-800 p-2 rounded flex-1 cursor-pointer hover:bg-gray-750"
                            onClick={() => {
                              const fullPath = `C:\\pa\\07-dev-play\\11_dev-formulare\\20_PDF_erstellung\\PDF-mapping\\formulare\\${kategorie.replace(/\//g, '\\')}\\${formularId}\\grundlagen\\`;
                              navigator.clipboard.writeText(fullPath);
                              alert('Pfad in Zwischenablage kopiert!');
                            }}
                            title="Klicken zum Kopieren"
                          >
                            {`C:\\pa\\07-dev-play\\11_dev-formulare\\20_PDF_erstellung\\PDF-mapping\\formulare\\${kategorie.replace(/\//g, '\\')}\\${formularId}\\grundlagen\\`}
                          </p>
                          <button
                            onClick={async () => {
                              const fullPath = `C:\\pa\\07-dev-play\\11_dev-formulare\\20_PDF_erstellung\\PDF-mapping\\formulare\\${kategorie.replace(/\//g, '\\')}\\${formularId}\\grundlagen\\`;
                              try {
                                const response = await fetch('/api/open-folder', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ path: fullPath })
                                });
                                if (!response.ok) {
                                  // Fallback: Pfad kopieren
                                  await navigator.clipboard.writeText(fullPath);
                                  alert('Pfad in Zwischenablage kopiert! (Explorer konnte nicht geöffnet werden)');
                                }
                              } catch (error) {
                                // Fallback: Pfad kopieren
                                await navigator.clipboard.writeText(fullPath);
                                alert('Pfad in Zwischenablage kopiert!');
                              }
                            }}
                            className="px-3 py-1 text-xs bg-gray-600 text-gray-200 border border-gray-500 rounded hover:bg-gray-500 transition-colors"
                            title="Ordner im Explorer öffnen"
                          >
                            📂 Öffnen
                          </button>
                          <button
                            onClick={async () => {
                              const fullPath = `C:\\pa\\07-dev-play\\11_dev-formulare\\20_PDF_erstellung\\PDF-mapping\\formulare\\${kategorie.replace(/\//g, '\\')}\\${formularId}\\grundlagen\\`;
                              await navigator.clipboard.writeText(fullPath);
                              alert('Pfad in Zwischenablage kopiert!');
                            }}
                            className="px-3 py-1 text-xs bg-gray-600 text-gray-200 border border-gray-500 rounded hover:bg-gray-500 transition-colors"
                            title="Pfad kopieren"
                          >
                            📋 Kopieren
                          </button>
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                          💡 Klicken Sie auf "Öffnen" um den Ordner im Windows Explorer zu öffnen, oder auf "Kopieren" um den Pfad zu kopieren.
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          Die Dateien werden automatisch mit korrektem Namensschema umbenannt und in diesem Ordner gespeichert.
                        </p>
                      </div>

                      <div className="mt-4">
                        <label className="block text-sm font-medium mb-2 text-gray-300">
                          📎 Alle drei Dateien auswählen
                          <span className="text-xs text-gray-400 ml-2">(1x Template PDF, 1x Beispiel PDF, 1x Beispiel XML)</span>
                        </label>
                        <input
                          type="file"
                          accept=".pdf,.xml"
                          multiple
                          onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            const pdfFiles = files.filter(f => f.name.endsWith('.pdf'));
                            const xmlFiles = files.filter(f => f.name.endsWith('.xml'));

                            // Erste PDF = leeres, zweite PDF = gefülltes
                            if (pdfFiles.length >= 1) setBlankPdf(pdfFiles[0]);
                            if (pdfFiles.length >= 2) setFilledPdf(pdfFiles[1]);

                            // Erste XML
                            if (xmlFiles.length >= 1) setXmlFile(xmlFiles[0]);
                          }}
                          className="w-full px-4 py-2 border border-gray-600 rounded bg-gray-800 text-gray-200 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600"
                          disabled={isProcessing}
                          title="Wählen Sie alle benötigten Dateien aus (2 PDFs, 1 XML)"
                        />
                        {(blankPdf || filledPdf || xmlFile) && (
                          <div className="mt-3 space-y-1">
                            {blankPdf && <p className="text-sm text-green-400">✓ Template PDF (leer): {blankPdf.name}</p>}
                            {filledPdf && <p className="text-sm text-green-400">✓ Beispiel PDF (ausgefüllt): {filledPdf.name}</p>}
                            {xmlFile && <p className="text-sm text-green-400">✓ Beispiel XML: {xmlFile.name}</p>}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    // Für bestehende Formulare: Zeige vorhandene Dateien oder Upload
                    <div className="space-y-4">
                      {loadingFiles ? (
                        <div className="bg-gray-800 border border-gray-700 rounded p-4 text-center">
                          <p className="text-gray-400">Lade vorhandene Dateien...</p>
                        </div>
                      ) : existingFiles && (existingFiles.tpl.exists || existingFiles.demo.exists || existingFiles.demoXml.exists) ? (
                        // Vorhandene Dateien gefunden
                        <div className="bg-gray-800 border border-gray-700 rounded p-4">
                          <p className="text-sm text-gray-300 mb-3">
                            <strong>✓ Vorhandene Dateien gefunden und automatisch übernommen:</strong>
                          </p>
                          <p className="text-xs text-gray-400 mb-3">
                            Die Dateien aus dem SSOT-Ordner wurden automatisch geladen und können direkt für das Auto-Mapping verwendet werden.
                          </p>
                          <div className="space-y-2 mb-4">
                            {existingFiles.tpl.exists && (
                              <div className="flex items-center justify-between p-2 bg-gray-700 rounded">
                                <div>
                                  <span className="text-sm text-green-400">✓</span>
                                  <span className="text-sm text-gray-300 ml-2">Template PDF (leer): {existingFiles.tpl.name}</span>
                                </div>
                                <button
                                  onClick={() => setBlankPdf(null)}
                                  className="text-xs text-gray-400 hover:text-gray-200"
                                  title="Datei ersetzen"
                                >
                                  Ersetzen
                                </button>
                              </div>
                            )}
                            {existingFiles.demo.exists && (
                              <div className="flex items-center justify-between p-2 bg-gray-700 rounded">
                                <div>
                                  <span className="text-sm text-green-400">✓</span>
                                  <span className="text-sm text-gray-300 ml-2">Beispiel PDF (ausgefüllt): {existingFiles.demo.name}</span>
                                </div>
                                <button
                                  onClick={() => setFilledPdf(null)}
                                  className="text-xs text-gray-400 hover:text-gray-200"
                                  title="Datei ersetzen"
                                >
                                  Ersetzen
                                </button>
                              </div>
                            )}
                            {existingFiles.demoXml.exists && (
                              <div className="flex items-center justify-between p-2 bg-gray-700 rounded">
                                <div>
                                  <span className="text-sm text-green-400">✓</span>
                                  <span className="text-sm text-gray-300 ml-2">Beispiel XML: {existingFiles.demoXml.name}</span>
                                </div>
                                <button
                                  onClick={() => setXmlFile(null)}
                                  className="text-xs text-gray-400 hover:text-gray-200"
                                  title="Datei ersetzen"
                                >
                                  Ersetzen
                                </button>
                              </div>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 mb-3">
                            💡 Die vorhandenen Dateien werden verwendet. Falls Sie Dateien aktualisieren möchten, klicken Sie auf "Ersetzen".
                          </p>
                          <div className="bg-gray-700 border border-gray-600 rounded p-2">
                            <p className="text-xs text-gray-400 mb-1">
                              <strong>📁 Vollständiger Windows-Pfad:</strong>
                            </p>
                            <div className="flex items-center gap-2">
                              <p
                                className="text-xs text-gray-200 font-mono break-all bg-gray-800 p-2 rounded flex-1 cursor-pointer hover:bg-gray-750"
                                onClick={async () => {
                                  const fullPath = `C:\\pa\\07-dev-play\\11_dev-formulare\\20_PDF_erstellung\\PDF-mapping\\formulare\\${kategorie.replace(/\//g, '\\')}\\${formularId}\\grundlagen\\`;
                                  await navigator.clipboard.writeText(fullPath);
                                  alert('Pfad kopiert!');
                                }}
                                title="Klicken zum Kopieren"
                              >
                                {`C:\\pa\\07-dev-play\\11_dev-formulare\\20_PDF_erstellung\\PDF-mapping\\formulare\\${kategorie.replace(/\//g, '\\')}\\${formularId}\\grundlagen\\`}
                              </p>
                              <button
                                onClick={async () => {
                                  const fullPath = `C:\\pa\\07-dev-play\\11_dev-formulare\\20_PDF_erstellung\\PDF-mapping\\formulare\\${kategorie.replace(/\//g, '\\')}\\${formularId}\\grundlagen\\`;
                                  try {
                                    await fetch('/api/open-folder', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ path: fullPath })
                                    });
                                  } catch {
                                    await navigator.clipboard.writeText(fullPath);
                                    alert('Pfad kopiert!');
                                  }
                                }}
                                className="px-2 py-1 text-xs bg-gray-600 text-gray-200 border border-gray-500 rounded hover:bg-gray-500 transition-colors"
                                title="Ordner öffnen"
                              >
                                📂
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        // Keine Dateien gefunden - Upload anbieten
                        <div className="bg-gray-800 border border-gray-700 rounded p-3 mb-4">
                          <p className="text-sm text-gray-300 mb-2">
                            <strong>⚠️ Keine Dateien gefunden</strong>
                          </p>
                          <p className="text-xs text-gray-400 mb-3">
                            Für dieses Formular wurden noch keine Grundlagen-Dateien hochgeladen.
                          </p>
                          <div className="bg-gray-700 border border-gray-600 rounded p-2">
                            <p className="text-xs text-gray-400 mb-1">
                              <strong>📁 Vollständiger Windows-Pfad:</strong>
                            </p>
                            <div className="flex items-center gap-2">
                              <p
                                className="text-xs text-gray-200 font-mono break-all bg-gray-800 p-2 rounded flex-1 cursor-pointer hover:bg-gray-750"
                                onClick={async () => {
                                  const fullPath = `C:\\pa\\07-dev-play\\11_dev-formulare\\20_PDF_erstellung\\PDF-mapping\\formulare\\${kategorie.replace(/\//g, '\\')}\\${formularId}\\grundlagen\\`;
                                  await navigator.clipboard.writeText(fullPath);
                                  alert('Pfad kopiert!');
                                }}
                                title="Klicken zum Kopieren"
                              >
                                {`C:\\pa\\07-dev-play\\11_dev-formulare\\20_PDF_erstellung\\PDF-mapping\\formulare\\${kategorie.replace(/\//g, '\\')}\\${formularId}\\grundlagen\\`}
                              </p>
                              <button
                                onClick={async () => {
                                  const fullPath = `C:\\pa\\07-dev-play\\11_dev-formulare\\20_PDF_erstellung\\PDF-mapping\\formulare\\${kategorie.replace(/\//g, '\\')}\\${formularId}\\grundlagen\\`;
                                  try {
                                    await fetch('/api/open-folder', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ path: fullPath })
                                    });
                                  } catch {
                                    await navigator.clipboard.writeText(fullPath);
                                    alert('Pfad kopiert!');
                                  }
                                }}
                                className="px-2 py-1 text-xs bg-gray-600 text-gray-200 border border-gray-500 rounded hover:bg-gray-500 transition-colors"
                                title="Ordner öffnen"
                              >
                                📂
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-gray-400 mt-2">
                            💡 Klicken Sie auf 📂 um den Ordner im Windows Explorer zu öffnen, oder klicken Sie auf den Pfad zum Kopieren.
                          </p>
                        </div>
                      )}

                      {/* Upload-Felder nur anzeigen wenn Dateien fehlen oder ersetzt werden sollen */}
                      {(!existingFiles?.tpl.exists || !blankPdf) && (
                        <div>
                          <label className="block text-sm font-medium mb-2 text-gray-300">
                            1. Template PDF (leer, mit Checkboxen)
                            {existingFiles?.tpl.exists && <span className="ml-2 text-xs text-gray-500">(Ersetzen)</span>}
                          </label>
                          <p className="text-xs text-gray-500 mb-1">
                            Wählen Sie die Datei aus (z.B. aus Downloads oder einem anderen Ordner)
                          </p>
                          <input
                            type="file"
                            accept=".pdf"
                            onChange={(e) => setBlankPdf(e.target.files?.[0] || null)}
                            className="w-full px-4 py-2 border border-gray-600 rounded bg-gray-800 text-gray-200 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600"
                            disabled={isProcessing}
                            title="Leeres PDF mit Checkboxen auswählen (Datei kann aus jedem Ordner sein)"
                          />
                          {blankPdf && (
                            <p className="text-sm text-green-400 mt-1">
                              ✓ {existingFiles?.tpl.exists ? 'Übernommen aus SSOT' : 'Neu hochgeladen'}: {blankPdf.name}
                            </p>
                          )}
                          {!blankPdf && existingFiles?.tpl.exists && (
                            <p className="text-xs text-gray-400 mt-1">
                              Aktuell im SSOT: <code className="text-gray-300">{existingFiles.tpl.name}</code>
                              <span className="ml-2 text-green-400">(wird automatisch verwendet)</span>
                            </p>
                          )}
                          {!blankPdf && !existingFiles?.tpl.exists && (() => {
                            const [id, ...kurzParts] = formularId.split('-');
                            const kurz = kurzParts.join('-');
                            return (
                              <p className="text-xs text-gray-400 mt-1">
                                Wird gespeichert als: <code className="text-gray-300">{generateFileName(id, kurz, 'tpl', undefined, 'pdf')}</code>
                              </p>
                            );
                          })()}
                        </div>
                      )}

                      {(!existingFiles?.demo.exists || !filledPdf) && (
                        <div>
                          <label className="block text-sm font-medium mb-2 text-gray-300">
                            2. Beispiel PDF (ausgefüllt mit Demo-Daten)
                            {existingFiles?.demo.exists && <span className="ml-2 text-xs text-gray-500">(Ersetzen)</span>}
                          </label>
                          <p className="text-xs text-gray-500 mb-1">
                            Wählen Sie die Datei aus (z.B. aus Downloads oder einem anderen Ordner)
                          </p>
                          <input
                            type="file"
                            accept=".pdf"
                            onChange={(e) => setFilledPdf(e.target.files?.[0] || null)}
                            className="w-full px-4 py-2 border border-gray-600 rounded bg-gray-800 text-gray-200 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600"
                            disabled={isProcessing}
                            title="Gefülltes Beispiel-PDF auswählen (Datei kann aus jedem Ordner sein)"
                          />
                          {filledPdf && (
                            <p className="text-sm text-green-400 mt-1">
                              ✓ {existingFiles?.demo.exists ? 'Übernommen aus SSOT' : 'Neu hochgeladen'}: {filledPdf.name}
                            </p>
                          )}
                          {!filledPdf && existingFiles?.demo.exists && (
                            <p className="text-xs text-gray-400 mt-1">
                              Aktuell im SSOT: <code className="text-gray-300">{existingFiles.demo.name}</code>
                              <span className="ml-2 text-green-400">(wird automatisch verwendet)</span>
                            </p>
                          )}
                          {!filledPdf && !existingFiles?.demo.exists && (() => {
                            const [id, ...kurzParts] = formularId.split('-');
                            const kurz = kurzParts.join('-');
                            return (
                              <p className="text-xs text-gray-400 mt-1">
                                Wird gespeichert als: <code className="text-gray-300">{generateFileName(id, kurz, 'demo', undefined, 'pdf')}</code>
                              </p>
                            );
                          })()}
                        </div>
                      )}

                      {(!existingFiles?.demoXml.exists || !xmlFile) && (
                        <div>
                          <label className="block text-sm font-medium mb-2 text-gray-300">
                            3. Beispiel XML (mit Demo-Daten)
                            {existingFiles?.demoXml.exists && <span className="ml-2 text-xs text-gray-500">(Ersetzen)</span>}
                          </label>
                          <p className="text-xs text-gray-500 mb-1">
                            Wählen Sie die Datei aus (z.B. aus Downloads oder einem anderen Ordner)
                          </p>
                          <input
                            type="file"
                            accept=".xml"
                            onChange={(e) => setXmlFile(e.target.files?.[0] || null)}
                            className="w-full px-4 py-2 border border-gray-600 rounded bg-gray-800 text-gray-200 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600"
                            disabled={isProcessing}
                            title="XML-Datei mit Beispiel-Daten auswählen (Datei kann aus jedem Ordner sein)"
                          />
                          {xmlFile && (
                            <p className="text-sm text-green-400 mt-1">
                              ✓ {existingFiles?.demoXml.exists ? 'Übernommen aus SSOT' : 'Neu hochgeladen'}: {xmlFile.name}
                            </p>
                          )}
                          {!xmlFile && existingFiles?.demoXml.exists && (
                            <p className="text-xs text-gray-400 mt-1">
                              Aktuell im SSOT: <code className="text-gray-300">{existingFiles.demoXml.name}</code>
                              <span className="ml-2 text-green-400">(wird automatisch verwendet)</span>
                            </p>
                          )}
                          {!xmlFile && !existingFiles?.demoXml.exists && (() => {
                            const [id, ...kurzParts] = formularId.split('-');
                            const kurz = kurzParts.join('-');
                            return (
                              <p className="text-xs text-gray-400 mt-1">
                                Wird gespeichert als: <code className="text-gray-300">{generateFileName(id, kurz, 'demo-xml', undefined, 'xml')}</code>
                              </p>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!formularId && (
                <div className="bg-gray-800 border border-gray-700 rounded p-4">
                  <p className="text-gray-300 text-sm">
                    ⚠️ Bitte zuerst ein Formular auswählen oder neu erstellen, um Dateien hochzuladen.
                  </p>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="bg-red-900/30 border border-red-700 rounded p-4 text-red-300">
                  <strong>Fehler:</strong> {error}
                </div>
              )}

              {/* Progress */}
              {isProcessing && (
                <div className="bg-gray-800 border border-gray-700 rounded p-4">
                  <div className="flex items-center gap-3">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400"></div>
                    <span className="text-gray-300">{progress}</span>
                  </div>
                </div>
              )}

              {/* Button */}
              <button
                onClick={handleAutoMap}
                disabled={!formularId || !blankPdf || !filledPdf || !xmlFile || isProcessing}
                className="px-6 py-3 bg-gray-700 text-gray-200 border border-gray-600 rounded hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed disabled:border-gray-700 transition-colors"
              >
                {isProcessing ? "⏳ Läuft..." : "🔄 Auto-Mapping starten"}
              </button>

              {/* Ergebnis */}
              {mapping && !isProcessing && (
                <div className="bg-gray-800 border border-gray-700 rounded p-4">
                  <p className="text-gray-200 mb-2">
                    ✅ Mapping erfolgreich erstellt! {mapping.fields?.length || 0} Felder gefunden.
                  </p>
                  {blankPdf && (
                    <p className="text-xs text-gray-400 mb-3">
                      PDF für Anpassung: <code className="text-gray-300">{blankPdf.name}</code>
                    </p>
                  )}
                  <button
                    onClick={() => {
                      if (!blankPdf) {
                        setError("PDF-Datei fehlt! Bitte Datei laden.");
                        return;
                      }
                      setStep(2);
                    }}
                    className="mt-4 px-4 py-2 bg-gray-700 text-gray-200 border border-gray-600 rounded hover:bg-gray-600 transition-colors"
                  >
                    ➡️ Weiter zu Anpassung
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="h-full flex flex-col overflow-hidden">
            {(() => {
              // Detaillierte Debug-Info
              const debugInfo = {
                hasMapping: !!mapping,
                mappingFields: mapping?.fields?.length || 0,
                hasBlankPdf: !!blankPdf,
                blankPdfName: blankPdf?.name,
                blankPdfSize: blankPdf?.size,
                blankPdfType: blankPdf?.type,
                isFileInstance: blankPdf instanceof File,
                formularId,
                kategorie
              };

              console.log("🔍 SCHRITT 2 - Detaillierte Props-Prüfung:", debugInfo);

              // Zeige Debug-Panel wenn Daten fehlen
              if (!mapping || !blankPdf) {
                return (
                  <div className="max-w-4xl mx-auto p-8">
                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-4">
                      <h3 className="text-lg font-semibold text-gray-200 mb-4">🔍 Debug-Informationen</h3>
                      <div className="space-y-2 text-sm font-mono">
                        <div className={mapping ? "text-green-400" : "text-red-400"}>
                          Mapping: {mapping ? `✅ ${mapping.fields?.length || 0} Felder` : "❌ Fehlt"}
                        </div>
                        <div className={blankPdf ? "text-green-400" : "text-red-400"}>
                          PDF: {blankPdf ? `✅ ${blankPdf.name} (${(blankPdf.size / 1024).toFixed(1)} KB)` : "❌ Fehlt"}
                        </div>
                        <div className="text-gray-400">
                          Formular-ID: {formularId || "Nicht gesetzt"}
                        </div>
                        <div className="text-gray-400">
                          Kategorie: {kategorie || "Nicht gesetzt"}
                        </div>
                        <div className="text-gray-400 mt-4">
                          <strong>Debug-Details:</strong>
                          <pre className="mt-2 p-2 bg-gray-900 rounded text-xs overflow-auto max-h-60">
                            {JSON.stringify(debugInfo, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>

                    {!mapping && (
                      <div className="bg-red-900/30 border border-red-700 rounded p-4 mb-4">
                        <p className="text-red-300">⚠️ Kein Mapping vorhanden. Bitte zuerst Schritt 1 ausführen.</p>
                      </div>
                    )}
                    {!blankPdf && (
                      <div className="bg-yellow-900/30 border border-yellow-700 rounded p-4 mb-4">
                        <p className="text-yellow-300">⚠️ Kein PDF vorhanden. Bitte Datei in Schritt 1 laden.</p>
                      </div>
                    )}
                    <button
                      onClick={() => setStep(1)}
                      className="mt-4 px-4 py-2 bg-gray-700 text-gray-200 border border-gray-600 rounded hover:bg-gray-600 transition-colors"
                    >
                      ⬅️ Zurück zu Auto-Mapping
                    </button>
                  </div>
                );
              }

              // Alle Daten vorhanden - zeige PdfMapper mit Debug-Overlay
              return (
                <div className="h-full flex flex-col overflow-hidden">
                  {/* Debug-Overlay (kann ausgeblendet werden) */}
                  <div className="absolute top-2 right-2 z-50 bg-gray-800 border border-gray-600 rounded-lg p-3 shadow-lg max-w-md">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-semibold text-gray-200">🔍 Debug-Info</h4>
                      <button
                        onClick={(e) => {
                          const target = e.currentTarget.closest('.bg-gray-800') as HTMLElement | null;
                          if (target) target.style.display = 'none';
                        }}
                        className="text-gray-400 hover:text-gray-200 text-xs"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="text-xs space-y-1 font-mono">
                      <div className="text-green-400">✅ Mapping: {mapping.fields?.length || 0} Felder</div>
                      <div className="text-green-400">✅ PDF: {blankPdf.name}</div>
                      <div className="text-gray-400">📦 Größe: {(blankPdf.size / 1024).toFixed(1)} KB</div>
                      <div className="text-gray-400">📄 Typ: {blankPdf.type || 'application/pdf'}</div>
                      <div className="text-gray-400">🆔 File-Instance: {blankPdf instanceof File ? '✅' : '❌'}</div>
                    </div>
                  </div>

                  <div className="flex-1 min-h-0">
                    <PdfMapper
                      key={`${formularId}-${blankPdf.name}-${Date.now()}`}
                      initialMapping={mapping}
                      initialPdf={blankPdf}
                      onMappingComplete={handleMappingComplete}
                      onExport={() => setStep(3)}
                    />
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {step === 3 && (
          <div className="max-w-4xl mx-auto p-8">
            <h2 className="text-2xl font-semibold mb-6 text-gray-200">Schritt 3/3: Export</h2>

            {!mapping ? (
              <div className="bg-red-900/30 border border-red-700 rounded p-4 mb-4">
                <p className="text-red-300">⚠️ Kein Mapping vorhanden. Bitte zuerst Mapping erstellen.</p>
                <button
                  onClick={() => setStep(1)}
                  className="mt-4 px-4 py-2 bg-gray-700 text-gray-200 border border-gray-600 rounded hover:bg-gray-600 transition-colors"
                >
                  ⬅️ Zurück zu Auto-Mapping
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
                  <h3 className="text-lg font-semibold mb-4 text-gray-200">Mapping-Informationen</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Formular-ID:</span>
                      <span className="text-gray-200 font-mono">{formularId || 'Nicht gesetzt'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Kategorie:</span>
                      <span className="text-gray-200">{kategorie || 'Nicht gesetzt'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Felder im Mapping:</span>
                      <span className="text-gray-200">{mapping.fields?.length || 0} Felder</span>
                    </div>
                    {mapping.template_sha256 && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">Template-Hash:</span>
                        <span className="text-gray-200 font-mono text-xs">{mapping.template_sha256.substring(0, 16)}...</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
                  <h3 className="text-lg font-semibold mb-4 text-gray-200">Export-Optionen</h3>
                  <div className="space-y-4">
                    {/* XML-Datei herunterladen (aus SSOT) */}
                    <div className="border border-gray-600 rounded p-4 bg-gray-700">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="font-medium text-gray-200 mb-1">📋 XML-Datei aus SSOT herunterladen</h4>
                          <p className="text-xs text-gray-400">
                            Lädt die vorhandene XML-Datei aus dem SSOT herunter, die in Schritt 1 hochgeladen wurde.
                            Diese kann direkt verwendet werden, um Formulare zu befüllen.
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          if (!formularId) {
                            setError('Formular-ID fehlt');
                            return;
                          }

                          setIsProcessing(true);
                          setError(null);
                          setProgress('Lade XML-Datei...');

                          try {
                            // Hole XML-Dateiname aus SSOT
                            const filesResponse = await fetch(`/api/formulare/grundlagen?formularId=${formularId}&kategorie=${kategorie || 'steuern/spenden'}`);
                            const filesData = await filesResponse.json();

                            if (!filesData.demoXml || !filesData.demoXml.exists) {
                              throw new Error('Keine XML-Datei im SSOT gefunden. Bitte zuerst in Schritt 1 hochladen.');
                            }

                            // Lade XML-Datei
                            const downloadResponse = await fetch(
                              `/api/formulare/grundlagen/download?formularId=${formularId}&kategorie=${kategorie || 'steuern/spenden'}&type=demo-xml`
                            );

                            if (!downloadResponse.ok) {
                              throw new Error('Fehler beim Laden der XML-Datei');
                            }

                            const blob = await downloadResponse.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = filesData.demoXml.name || `${formularId}-demo-xml.xml`;
                            a.click();
                            URL.revokeObjectURL(url);

                            setProgress('');
                            alert(`✅ XML-Datei erfolgreich heruntergeladen!\n\nDatei: ${filesData.demoXml.name}`);
                          } catch (err: any) {
                            setError(err.message || 'Fehler beim Laden der XML-Datei');
                            setProgress('');
                          } finally {
                            setIsProcessing(false);
                          }
                        }}
                        disabled={isProcessing || !formularId}
                        className="px-4 py-2 bg-blue-700 text-gray-200 border border-blue-600 rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isProcessing ? '⏳ Lade...' : '📋 XML aus SSOT herunterladen'}
                      </button>
                    </div>

                    {/* Mapping-Download */}
                    <div className="border border-gray-600 rounded p-4 bg-gray-700">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="font-medium text-gray-200 mb-1">💾 Mapping als JSON herunterladen</h4>
                          <p className="text-xs text-gray-400">
                            Lädt das Mapping als JSON-Datei herunter. Kann später importiert oder weiterverarbeitet werden.
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (!mapping) {
                            setError('Kein Mapping vorhanden');
                            return;
                          }

                          const blob = new Blob([JSON.stringify(mapping, null, 2)], { type: 'application/json' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${formularId || 'mapping'}-${new Date().toISOString().split('T')[0]}.json`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        disabled={!mapping}
                        className="px-4 py-2 bg-gray-700 text-gray-200 border border-gray-600 rounded hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        💾 Mapping herunterladen
                      </button>
                    </div>

                    {/* Export nach Template-System */}
                    <div className="border border-gray-600 rounded p-4 bg-gray-700">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="font-medium text-gray-200 mb-1">📤 Export nach Template-System</h4>
                          <p className="text-xs text-gray-400">
                            Exportiert Mapping und Template-PDF in das Template-System für die weitere Verwendung.
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          if (!mapping || !blankPdf) {
                            setError('Mapping oder PDF fehlt');
                            return;
                          }

                          try {
                            // Generiere Mapping-Dateiname
                            const { generateMappingFileName } = await import('../lib/filename-helper');
                            const mappingFileName = generateMappingFileName(formularId, 'current');

                            const basePath = "C:\\pa\\07-dev-play\\11_dev-formulare";
                            const templateDir = `${basePath}\\21-Template-System\\templates\\${formularId || 'template'}`;
                            const mappingSourcePath = `C:\\pa\\07-dev-play\\11_dev-formulare\\20_PDF_erstellung\\PDF-mapping\\formulare\\${(kategorie || 'steuern/spenden').replace(/\//g, '\\')}\\${formularId}\\mappings\\${mappingFileName}`;
                            const pdfSourcePath = `C:\\pa\\07-dev-play\\11_dev-formulare\\20_PDF_erstellung\\PDF-mapping\\formulare\\${(kategorie || 'steuern/spenden').replace(/\//g, '\\')}\\${formularId}\\grundlagen\\${blankPdf.name}`;

                            const commands = [
                              `# PowerShell-Befehle zum Export nach Template-System:`,
                              `$templateDir = "${templateDir}"`,
                              `New-Item -ItemType Directory -Force -Path $templateDir`,
                              ``,
                              `# Mapping kopieren`,
                              `Copy-Item -Path "${mappingSourcePath}" -Destination "$templateDir\\mapping.json" -Force`,
                              ``,
                              `# Template-PDF kopieren`,
                              `Copy-Item -Path "${pdfSourcePath}" -Destination "$templateDir\\template.pdf" -Force`,
                              ``,
                              `Write-Host "✅ Export abgeschlossen!" -ForegroundColor Green`,
                              `Write-Host "📁 Ziel: $templateDir" -ForegroundColor Cyan`,
                            ].join("\n");

                            await navigator.clipboard.writeText(commands);
                            alert('PowerShell-Befehle in Zwischenablage kopiert! Paste in PowerShell und führe aus.');
                          } catch (err: any) {
                            alert(`Fehler beim Kopieren der Befehle: ${err.message}`);
                          }
                        }}
                        disabled={!mapping || !blankPdf}
                        className="px-4 py-2 bg-purple-700 text-gray-200 border border-purple-600 rounded hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        📤 Export nach Template-System
                      </button>
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="bg-red-900/30 border border-red-700 rounded p-4">
                    <p className="text-red-300">❌ {error}</p>
                  </div>
                )}

                {progress && (
                  <div className="bg-blue-900/30 border border-blue-700 rounded p-4">
                    <p className="text-blue-300">⏳ {progress}</p>
                  </div>
                )}

                <div className="flex gap-4">
                  <button
                    onClick={() => setStep(2)}
                    className="px-4 py-2 border border-gray-600 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
                  >
                    ⬅️ Zurück zu Anpassung
                  </button>
                  <button
                    onClick={() => setStep(1)}
                    className="px-4 py-2 border border-gray-600 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
                  >
                    🏠 Neu starten
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

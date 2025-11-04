"use client";

import { useState, useEffect } from "react";
import { loadFormularIndex, type FormularIndex, type FormularMetadata } from "../lib/formular-index";

type Mode = "select" | "new";

interface FormularAuswahlNeuProps {
  onSelect: (formularId: string, kategorie: string) => void;
  onNew: (formularId: string, kategorie: string) => void;
  initialFormularId?: string;
}

export default function FormularAuswahlNeu({ onSelect, onNew, initialFormularId }: FormularAuswahlNeuProps) {
  const [mode, setMode] = useState<Mode>("select");
  const [index, setIndex] = useState<FormularIndex | null>(null);
  const [selectedFormular, setSelectedFormular] = useState<FormularMetadata | null>(null);
  const [loading, setLoading] = useState(true);

  // Neue Formular-Eingabe
  const [formularnummer, setFormularnummer] = useState("");
  const [klarname, setKlarname] = useState("");
  const [variante, setVariante] = useState("");
  const [newKategorie, setNewKategorie] = useState("steuern/spenden");

  // Dynamische Listen (können erweitert werden)
  const [varianteOptions, setVarianteOptions] = useState([
    "geld",
    "sach",
    "verein",
    "privat",
    "unternehmen"
  ]);

  const [kategorieOptions, setKategorieOptions] = useState([
    "steuern/spenden",
    "steuern/einkommen",
    "soziales/bildung",
    "verwaltung"
  ]);

  // Dialog-Zustände für neue Werte
  const [showNewVariante, setShowNewVariante] = useState(false);
  const [showNewKategorie, setShowNewKategorie] = useState(false);
  const [newVarianteInput, setNewVarianteInput] = useState("");
  const [newKategorieInput, setNewKategorieInput] = useState("");

  useEffect(() => {
    loadFormularIndex().then(data => {
      setIndex(data);
      setLoading(false);

      // Wenn initialFormularId gesetzt, versuche es zu finden
      if (initialFormularId && data.formulare.length > 0) {
        const found = data.formulare.find(f => f.id === initialFormularId);
        if (found) {
          setSelectedFormular(found);
        }
      }
    });
  }, []);

  const handleSelectFormular = (formular: FormularMetadata) => {
    setSelectedFormular(formular);
    onSelect(formular.id, formular.kategorie);
  };

  const handleCreateNew = () => {
    if (!formularnummer || !klarname || !variante) {
      alert("Bitte alle Felder ausfüllen!");
      return;
    }

    const newFormularId = `${formularnummer}-${klarname}-${variante}`;
    onNew(newFormularId, newKategorie);
  };

  const handleAddVariante = () => {
    if (newVarianteInput.trim() && !varianteOptions.includes(newVarianteInput.toLowerCase())) {
      setVarianteOptions([...varianteOptions, newVarianteInput.toLowerCase()]);
      setVariante(newVarianteInput.toLowerCase());
      setNewVarianteInput("");
      setShowNewVariante(false);
    }
  };

  const handleAddKategorie = () => {
    if (newKategorieInput.trim() && !kategorieOptions.includes(newKategorieInput.toLowerCase())) {
      setKategorieOptions([...kategorieOptions, newKategorieInput.toLowerCase()]);
      setNewKategorie(newKategorieInput.toLowerCase());
      setNewKategorieInput("");
      setShowNewKategorie(false);
    }
  };

  if (loading) {
    return <div className="text-center py-4 text-gray-400">Lade Formulare...</div>;
  }

  if (mode === "new") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-200">Neues Formular erstellen</h3>
          <button
            onClick={() => setMode("select")}
            className="px-3 py-1 text-sm border border-gray-600 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
          >
            ← Zurück zur Auswahl
          </button>
        </div>

        <div className="space-y-4">
          {/* Kategorie */}
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-300">Kategorie</label>
            <div className="space-y-2">
              <select
                value={newKategorie}
                onChange={(e) => {
                  if (e.target.value === "__NEW__") {
                    setShowNewKategorie(true);
                  } else {
                    setNewKategorie(e.target.value);
                  }
                }}
                className="w-full px-4 py-2 border border-gray-600 rounded bg-gray-800 text-gray-200"
              >
                {kategorieOptions.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
                <option value="__NEW__" className="bg-gray-700">+ Neue Kategorie erstellen</option>
              </select>
              {showNewKategorie && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newKategorieInput}
                    onChange={(e) => setNewKategorieInput(e.target.value)}
                    placeholder="z.B. steuern/erbschaft"
                    className="flex-1 px-4 py-2 border border-gray-600 rounded bg-gray-800 text-gray-200 placeholder-gray-500"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddKategorie()}
                    autoFocus
                  />
                  <button
                    onClick={handleAddKategorie}
                    className="px-4 py-2 bg-gray-700 text-gray-200 border border-gray-600 rounded hover:bg-gray-600 transition-colors"
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => {
                      setShowNewKategorie(false);
                      setNewKategorieInput("");
                    }}
                    className="px-4 py-2 bg-gray-700 text-gray-200 border border-gray-600 rounded hover:bg-gray-600 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Strukturierte Eingabe */}
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-300">Formular-ID</label>
            <div className="flex items-center gap-2">
              {/* Formularnummer */}
              <input
                type="text"
                value={formularnummer}
                onChange={(e) => setFormularnummer(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="034122"
                className="flex-1 px-4 py-2 border border-gray-600 rounded bg-gray-800 text-gray-200 placeholder-gray-500"
                maxLength={6}
              />

              {/* Fixes Bindestrich */}
              <span className="text-2xl font-bold text-gray-500">-</span>

              {/* Klarname */}
              <input
                type="text"
                value={klarname}
                onChange={(e) => setKlarname(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="spendenbescheinigung"
                className="flex-1 px-4 py-2 border border-gray-600 rounded bg-gray-800 text-gray-200 placeholder-gray-500"
              />

              {/* Fixes Bindestrich */}
              <span className="text-2xl font-bold text-gray-500">-</span>

              {/* Variante (Dropdown) */}
              <div className="flex-1">
                <select
                  value={variante}
                  onChange={(e) => {
                    if (e.target.value === "__NEW__") {
                      setShowNewVariante(true);
                    } else {
                      setVariante(e.target.value);
                    }
                  }}
                  className="w-full px-4 py-2 border border-gray-600 rounded bg-gray-800 text-gray-200"
                >
                  <option value="">Variante wählen...</option>
                  {varianteOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                  <option value="__NEW__" className="bg-gray-700">+ Neue Variante erstellen</option>
                </select>
                {showNewVariante && (
                  <div className="flex gap-2 mt-2">
                    <input
                      type="text"
                      value={newVarianteInput}
                      onChange={(e) => setNewVarianteInput(e.target.value)}
                      placeholder="z.B. steuerberater"
                      className="flex-1 px-4 py-2 border border-gray-600 rounded bg-gray-800 text-gray-200 placeholder-gray-500"
                      onKeyDown={(e) => e.key === 'Enter' && handleAddVariante()}
                      autoFocus
                    />
                    <button
                      onClick={handleAddVariante}
                      className="px-4 py-2 bg-gray-700 text-gray-200 border border-gray-600 rounded hover:bg-gray-600 transition-colors"
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => {
                        setShowNewVariante(false);
                        setNewVarianteInput("");
                      }}
                      className="px-4 py-2 bg-gray-700 text-gray-200 border border-gray-600 rounded hover:bg-gray-600 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Vorschau */}
            {formularnummer && klarname && variante && (
              <div className="mt-2 p-2 bg-gray-800 border border-gray-700 rounded text-sm">
                <span className="text-gray-400">Vorschau: </span>
                <span className="font-mono font-semibold text-gray-200">
                  {formularnummer}-{klarname}-{variante}
                </span>
              </div>
            )}
          </div>

          <button
            onClick={handleCreateNew}
            disabled={!formularnummer || !klarname || !variante}
            className="w-full px-4 py-2 bg-gray-700 text-gray-200 border border-gray-600 rounded hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
          >
            ✅ Formular erstellen
          </button>
        </div>
      </div>
    );
  }

  // Select-Mode
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-200">Bestehendes Formular auswählen</h3>
        <button
          onClick={() => setMode("new")}
          className="px-4 py-2 bg-gray-700 text-gray-200 border border-gray-600 rounded hover:bg-gray-600 transition-colors"
        >
          ➕ Neu erstellen
        </button>
      </div>

      {index && index.formulare.length > 0 ? (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {index.formulare
            .filter(f => f.status === "aktiv")
            .map(formular => (
              <div
                key={formular.id}
                onClick={() => handleSelectFormular(formular)}
                className={`p-3 border rounded cursor-pointer transition-colors ${
                  selectedFormular?.id === formular.id
                    ? 'bg-gray-700 border-gray-500'
                    : 'bg-gray-800 border-gray-700 hover:bg-gray-700'
                }`}
              >
                <div className="font-semibold text-gray-100">
                  {formular.formularnummer} - {formular.name}
                </div>
                {formular.beschreibung && (
                  <div className="text-sm text-gray-400 mt-1">{formular.beschreibung}</div>
                )}
                <div className="text-xs text-gray-500 mt-1">
                  {formular.kategorie}
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-400">
          <p>Keine Formulare gefunden.</p>
          <button
            onClick={() => setMode("new")}
            className="mt-4 px-4 py-2 bg-gray-700 text-gray-200 border border-gray-600 rounded hover:bg-gray-600 transition-colors"
          >
            ➕ Erstes Formular erstellen
          </button>
        </div>
      )}
    </div>
  );
}

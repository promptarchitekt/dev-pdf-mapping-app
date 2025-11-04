"use client";

import { useState, useEffect } from "react";
import { loadFormularIndex, searchFormulare, filterByKategorie, getKategorien, groupByKategorie, type FormularMetadata, type FormularIndex } from "../lib/formular-index";

interface FormularAuswahlProps {
  onSelect: (formularId: string, kategorie: string) => void;
  onCancel?: () => void;
}

export default function FormularAuswahl({ onSelect, onCancel }: FormularAuswahlProps) {
  const [index, setIndex] = useState<FormularIndex | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedKategorie, setSelectedKategorie] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFormularIndex().then(data => {
      setIndex(data);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <div className="text-center">Lade Formulare...</div>
      </div>
    );
  }

  if (!index) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <div className="text-red-600">Fehler beim Laden der Formulare</div>
      </div>
    );
  }

  // Suche + Filter
  let filtered = searchFormulare(index, searchQuery);
  if (selectedKategorie) {
    filtered = filterByKategorie(filtered, selectedKategorie);
  }

  // Nur aktive Formulare
  filtered = filtered.filter(f => f.status === "aktiv");

  const kategorien = getKategorien(index);
  const grouped = groupByKategorie(filtered);

  return (
    <div className="max-w-6xl mx-auto p-8">
      <h2 className="text-2xl font-semibold mb-6">Formular auswählen</h2>

      {/* Suche */}
      <div className="mb-6">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Suche nach Name, Nummer, Tags..."
          className="w-full px-4 py-2 border rounded"
        />
      </div>

      <div className="grid grid-cols-[250px_1fr] gap-6">
        {/* Kategorien-Filter */}
        <div className="bg-gray-50 p-4 rounded">
          <h3 className="font-semibold mb-3">📁 Kategorien</h3>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="kategorie"
                checked={selectedKategorie === null}
                onChange={() => setSelectedKategorie(null)}
              />
              <span>Alle</span>
            </label>
            {kategorien.map(kat => (
              <label key={kat} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="kategorie"
                  checked={selectedKategorie === kat}
                  onChange={() => setSelectedKategorie(kat)}
                />
                <span className="text-sm">{kat}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Formulare-Liste */}
        <div>
          {Object.keys(grouped).length === 0 ? (
            <div className="text-gray-500 text-center py-8">
              Keine Formulare gefunden
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(grouped).map(([kategorie, formulare]) => (
                <div key={kategorie}>
                  <h4 className="font-medium text-gray-700 mb-2">{kategorie}</h4>
                  <div className="space-y-2">
                    {formulare.map(formular => (
                      <div
                        key={formular.id}
                        className="border rounded p-4 hover:bg-blue-50 cursor-pointer"
                        onClick={() => onSelect(formular.id, formular.kategorie)}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-semibold">
                              {formular.formularnummer} - {formular.name}
                            </div>
                            {formular.beschreibung && (
                              <div className="text-sm text-gray-600 mt-1">
                                {formular.beschreibung}
                              </div>
                            )}
                            <div className="flex gap-2 mt-2">
                              {formular.tags.map(tag => (
                                <span
                                  key={tag}
                                  className="text-xs px-2 py-1 bg-gray-200 rounded"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="text-right">
                            <span className={`text-xs px-2 py-1 rounded ${
                              formular.status === "aktiv" ? "bg-green-100 text-green-800" :
                              formular.status === "in-arbeit" ? "bg-yellow-100 text-yellow-800" :
                              "bg-gray-100 text-gray-800"
                            }`}>
                              {formular.status}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {onCancel && (
        <div className="mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 border rounded hover:bg-gray-50"
          >
            Abbrechen
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Formular-Index: Verwaltung und Suche für alle Formulare
 */

export type Kategorie = string; // z.B. "steuern/spenden"

export interface FormularMetadata {
  id: string;
  formularnummer: string;
  name: string;
  beschreibung?: string;
  kategorie: Kategorie;
  pfad: string; // Relativer Pfad (z.B. "steuern/spenden/034122-spendenbescheinigung-geld")
  status: "aktiv" | "in-arbeit" | "veraltet" | "archiviert";
  version?: string;
  tags: string[];
  erstellt: string;
  zuletztBearbeitet: string;
  mappingStatus?: "fertig" | "in-arbeit" | "fehlt";
  mappingVersion?: string;
}

export interface FormularIndex {
  version: string;
  lastUpdated: string;
  formulare: FormularMetadata[];
}

/**
 * Lädt den Formular-Index
 */
export async function loadFormularIndex(): Promise<FormularIndex> {
  try {
    const response = await fetch('/api/formulare/index');
    if (!response.ok) {
      throw new Error('Index konnte nicht geladen werden');
    }
    return await response.json();
  } catch (error) {
    console.error('Fehler beim Laden des Index:', error);
    return {
      version: "1.0",
      lastUpdated: new Date().toISOString(),
      formulare: []
    };
  }
}

/**
 * Sucht Formulare nach Query
 */
export function searchFormulare(
  index: FormularIndex,
  query: string
): FormularMetadata[] {
  if (!query.trim()) {
    return index.formulare;
  }

  const q = query.toLowerCase();

  return index.formulare.filter(f =>
    f.name.toLowerCase().includes(q) ||
    f.formularnummer.includes(q) ||
    f.id.toLowerCase().includes(q) ||
    f.tags.some(tag => tag.toLowerCase().includes(q)) ||
    f.beschreibung?.toLowerCase().includes(q)
  );
}

/**
 * Filtert Formulare nach Kategorie
 */
export function filterByKategorie(
  formulare: FormularMetadata[],
  kategorie: Kategorie | null
): FormularMetadata[] {
  if (!kategorie) {
    return formulare;
  }

  return formulare.filter(f => f.kategorie === kategorie || f.kategorie.startsWith(kategorie + '/'));
}

/**
 * Filtert Formulare nach Status
 */
export function filterByStatus(
  formulare: FormularMetadata[],
  status: FormularMetadata["status"] | null
): FormularMetadata[] {
  if (!status) {
    return formulare;
  }

  return formulare.filter(f => f.status === status);
}

/**
 * Extrahiert alle Kategorien aus Index
 */
export function getKategorien(index: FormularIndex): Kategorie[] {
  const kategorien = new Set<string>();

  index.formulare.forEach(f => {
    // Füge Hauptkategorie hinzu
    const parts = f.kategorie.split('/');
    kategorien.add(parts[0]);

    // Füge vollständige Kategorie hinzu
    kategorien.add(f.kategorie);
  });

  return Array.from(kategorien).sort();
}

/**
 * Gruppiert Formulare nach Kategorie
 */
export function groupByKategorie(
  formulare: FormularMetadata[]
): Record<string, FormularMetadata[]> {
  const groups: Record<string, FormularMetadata[]> = {};

  formulare.forEach(f => {
    const mainKategorie = f.kategorie.split('/')[0];
    if (!groups[mainKategorie]) {
      groups[mainKategorie] = [];
    }
    groups[mainKategorie].push(f);
  });

  return groups;
}

/**
 * Generiert XML-Vorlage aus Mapping
 *
 * Erstellt eine LUCOM-kompatible XML-Vorlage basierend auf den Feldern im Mapping.
 * Die XML kann später verwendet werden, um Formulare zu befüllen.
 */

type MappingField =
  | { id: string; page: number; type?: "text" | "date_de" | "checkbox"; x?: number | null; y?: number | null; w?: number; align?: "left" | "right" }
  | { id: string; page: number; type: "boolean_pair"; x_true?: number | null; y_true?: number | null; x_false?: number | null; y_false?: number | null };

type Mapping = {
  template?: string;
  template_sha256?: string;
  template_source?: string;
  font?: string;
  size?: number;
  status?: string;
  fields: MappingField[];
};

/**
 * Generiert Beispiel-Wert für ein Feld basierend auf seinem Typ und ID
 */
function generateExampleValue(field: MappingField): string {
  const id = field.id.toLowerCase();

  // ID_USER ist immer .anonymous
  if (id === 'id_user') {
    return '.anonymous';
  }

  // Datums-Felder
  if (field.type === 'date_de' || id.includes('datum')) {
    return '01.01.2025 00:00:00';
  }

  // Boolean-Pairs (Ja/Nein-Felder)
  if (field.type === 'boolean_pair') {
    return 'true'; // Default: Ja
  }

  // Checkboxen
  if (field.type === 'checkbox') {
    return 'true';
  }

  // Beträge / Werte
  if (id === 'wert') {
    return '500,00 €';
  }

  // Zahlen in Textform
  if (id === 'wert2') {
    return 'fünfhundert';
  }

  // Steuernummer
  if (id === 'stnr' || id === 'stnr2' || id.includes('steuernummer')) {
    return '103/123/4567';
  }

  // Finanzamt
  if (id === 'finamt' || id === 'finamt2' || id.includes('finanzamt')) {
    return 'Finanzamt Düsseldorf-Nord';
  }

  // Zeitraum / Jahr
  if (id === 'zeitraum' || id.includes('jahr')) {
    return '2022';
  }

  // Ort/Datum
  if (id === 'ort_datum' || id === 'ortdatum') {
    return 'Erkrath, 29.10.2025';
  }

  // Zwecke
  if (id === 'zwecke' || id === 'zwecke2b2') {
    return 'Förderung der Erziehung (§ 52 Abs. 2 S. 1 Nr. 7 AO)';
  }

  if (id === 'zwecke2b') {
    return '§ 5 Abs. 1 Nr 9 KStG';
  }

  // Standard-Beispiele (basierend auf kita-maerchenland.xml)
  if (id === 'name') {
    return 'Marcel Reichl, Waldstraße 20, 40699 Erkrath, Deutschland';
  }

  if (id === 'aussteller') {
    return 'KiTa Märchenland, Liliencronstraße 63, 40472 Düsseldorf';
  }

  // Default
  return '[Beispiel-Wert]';
}

/**
 * Extrahiert Formularnummer aus Mapping oder Formular-ID
 */
function extractFormNumber(formularId: string, templateSource?: string): string {
  // Versuche aus template_source (z.B. "034122_mit.pdf")
  if (templateSource) {
    const match = templateSource.match(/^(\d{6})/);
    if (match) {
      return match[1];
    }
  }

  // Versuche aus formularId (z.B. "034122-geldspende-verein")
  const match = formularId.match(/^(\d{6})/);
  if (match) {
    return match[1];
  }

  // Fallback
  return '034122';
}

/**
 * Generiert XML-Vorlage aus Mapping
 */
export function generateXmlTemplate(
  mapping: Mapping,
  formularId: string,
  formNumber?: string
): string {
  // Extrahiere Formularnummer
  const formNum = formNumber || extractFormNumber(formularId, mapping.template_source);

  // Filtere Felder (keine ID_USER, nur Felder mit id)
  const fields = mapping.fields.filter(f => f.id && f.id !== 'ID_USER');

  // Sortiere Felder alphabetisch nach ID
  fields.sort((a, b) => a.id.localeCompare(b.id));

  // Generiere XML-Elemente
  const elements = fields.map(field => {
    const exampleValue = generateExampleValue(field);
    return `\t\t\t<element id="${field.id}">${exampleValue}</element>`;
  });

  // Füge ID_USER am Anfang hinzu
  elements.unshift('\t\t\t<element id="ID_USER">.anonymous</element>');

  // Generiere vollständige XML
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xml-data xmlns="http://www.lucom.com/ffw/xml-data-1.0.xsd">
\t<form>catalog://Steuerformulare/gemein/${formNum}</form>
\t<instance>
\t\t<datarow>
${elements.join('\n')}
\t\t</datarow>
\t</instance>
</xml-data>`;

  return xml;
}

/**
 * Validiert ob Mapping gültig ist für XML-Generierung
 */
export function validateMappingForXml(mapping: Mapping): {
  valid: boolean;
  error?: string;
} {
  if (!mapping || !mapping.fields) {
    return {
      valid: false,
      error: 'Mapping ist leer oder ungültig'
    };
  }

  if (!Array.isArray(mapping.fields)) {
    return {
      valid: false,
      error: 'Mapping.fields muss ein Array sein'
    };
  }

  if (mapping.fields.length === 0) {
    return {
      valid: false,
      error: 'Mapping enthält keine Felder'
    };
  }

  // Prüfe ob mindestens ein Feld eine ID hat
  const hasFields = mapping.fields.some(f => f.id && f.id !== 'ID_USER');
  if (!hasFields) {
    return {
      valid: false,
      error: 'Mapping enthält keine gültigen Felder (außer ID_USER)'
    };
  }

  return { valid: true };
}

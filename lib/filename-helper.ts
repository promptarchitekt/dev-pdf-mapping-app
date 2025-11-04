/**
 * Helper-Funktionen für das Namensschema:
 * {id}-{kurz}-{artefakt}[-vN].{ext}
 */

export interface FileNameParts {
  id: string;
  kurz: string;
  artefakt: string;
  version?: string;
  ext: string;
}

/**
 * Generiert Dateiname nach Schema
 */
export function generateFileName(
  id: string,
  kurz: string,
  artefakt: string,
  version?: string,
  ext: string = 'json'
): string {
  const parts = [id, kurz, artefakt];
  if (version) {
    parts.push(version);
  }
  return `${parts.join('-')}.${ext}`;
}

/**
 * Parst Dateiname nach Schema
 */
export function parseFileName(filename: string): FileNameParts | null {
  try {
    const [name, ext] = filename.split('.');
    if (!name || !ext) {
      return null;
    }

    const parts = name.split('-');

    if (parts.length < 3) {
      return null; // Mindestens: id, kurz, artefakt
    }

    const id = parts[0];

    // Prüfe ob letztes Teil eine Version ist (v1, v2, etc.)
    const lastPart = parts[parts.length - 1];
    const hasVersion = /^v\d+$/.test(lastPart);

    let artefakt: string;
    let version: string | undefined;
    let kurzParts: string[];

    if (hasVersion) {
      // Format: id-kurz-artefakt-v1
      version = lastPart;
      artefakt = parts[parts.length - 2];
      kurzParts = parts.slice(1, -2);
    } else {
      // Format: id-kurz-artefakt
      artefakt = lastPart;
      kurzParts = parts.slice(1, -1);
    }

    return {
      id,
      kurz: kurzParts.join('-'),
      artefakt,
      version,
      ext
    };
  } catch {
    return null;
  }
}

/**
 * Extrahiert Formular-ID aus Dateiname
 */
export function extractFormularId(filename: string): string | null {
  const parsed = parseFileName(filename);
  if (!parsed) {
    return null;
  }

  // Formular-ID = id-kurz
  return `${parsed.id}-${parsed.kurz}`;
}

/**
 * Validiert Dateiname gegen Schema
 */
export function validateFileName(filename: string): {
  valid: boolean;
  error?: string;
} {
  const parsed = parseFileName(filename);

  if (!parsed) {
    return {
      valid: false,
      error: 'Dateiname entspricht nicht dem Schema: {id}-{kurz}-{artefakt}[-vN].{ext}'
    };
  }

  // Validiere ID (6-stellig)
  if (!/^\d{6}$/.test(parsed.id)) {
    return {
      valid: false,
      error: `ID muss 6-stellig sein: ${parsed.id}`
    };
  }

  // Validiere Artefakt
  const validArtefakte = [
    'tpl', 'demo', 'demo-xml',
    'map-auto', 'map-man', 'map-current',
    'map-pdf', 'map-json', 'map-xml'
  ];

  if (!validArtefakte.includes(parsed.artefakt)) {
    return {
      valid: false,
      error: `Ungültiger Artefakt: ${parsed.artefakt}. Erlaubt: ${validArtefakte.join(', ')}`
    };
  }

  // Validiere Version (falls vorhanden)
  if (parsed.version && !/^v\d+$/.test(parsed.version)) {
    return {
      valid: false,
      error: `Ungültige Version: ${parsed.version}. Format: v1, v2, etc.`
    };
  }

  return { valid: true };
}

/**
 * Generiert Mapping-Dateinamen
 */
export function generateMappingFileName(
  formularId: string, // z.B. "034122-geldspende-verein"
  type: 'auto' | 'manual' | 'current',
  version?: string
): string {
  const [id, ...kurzParts] = formularId.split('-');
  const kurz = kurzParts.join('-');
  const artefakt = type === 'auto' ? 'map-auto' : type === 'manual' ? 'map-man' : 'map-current';

  return generateFileName(id, kurz, artefakt, version, 'json');
}

/**
 * Generiert Export-Dateinamen
 */
export function generateExportFileName(
  formularId: string,
  artefakt: 'map-pdf' | 'map-json' | 'map-xml',
  version?: string
): string {
  const [id, ...kurzParts] = formularId.split('-');
  const kurz = kurzParts.join('-');
  const ext = artefakt === 'map-pdf' ? 'pdf' : artefakt === 'map-json' ? 'json' : 'xml';

  return generateFileName(id, kurz, artefakt, version, ext);
}

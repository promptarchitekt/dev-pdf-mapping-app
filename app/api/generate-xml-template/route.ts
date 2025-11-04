import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { generateXmlTemplate, validateMappingForXml } from '../../../lib/generate-xml-template';
import { generateFileName } from '../../../lib/filename-helper';

export async function POST(req: NextRequest) {
  try {
    const { mapping, formularId, kategorie } = await req.json();

    if (!mapping) {
      return NextResponse.json(
        { error: 'Mapping ist erforderlich' },
        { status: 400 }
      );
    }

    if (!formularId) {
      return NextResponse.json(
        { error: 'Formular-ID ist erforderlich' },
        { status: 400 }
      );
    }

    // Validiere Mapping
    const validation = validateMappingForXml(mapping);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    // Extrahiere ID und Kurzname aus formularId
    const [id, ...kurzParts] = formularId.split('-');
    const kurz = kurzParts.join('-');

    // Generiere XML-Vorlage
    const xmlContent = generateXmlTemplate(mapping, formularId);

    // Generiere Dateiname
    const fileName = generateFileName(id, kurz, 'template', undefined, 'xml');

    // Speichere XML-Datei
    const baseDir = join(process.cwd(), '..', 'formulare');
    const grundlagenDir = join(baseDir, kategorie || 'steuern/spenden', formularId, 'grundlagen');

    // Stelle sicher, dass Verzeichnis existiert
    await mkdir(grundlagenDir, { recursive: true });

    const filePath = join(grundlagenDir, fileName);
    await writeFile(filePath, xmlContent, 'utf-8');

    console.log('✅ XML-Vorlage generiert:', filePath);

    return NextResponse.json({
      success: true,
      fileName,
      path: filePath,
      message: `XML-Vorlage wurde generiert: ${fileName}`
    });

  } catch (error: any) {
    console.error('❌ Fehler beim Generieren der XML-Vorlage:', error);
    return NextResponse.json(
      { error: `Fehler beim Generieren der XML-Vorlage: ${error.message}` },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { generateFileName } from '../../../lib/filename-helper';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const formularId = formData.get('formularId') as string;
    const kategorie = formData.get('kategorie') as string;
    const blankPdf = formData.get('blankPdf') as File;
    const filledPdf = formData.get('filledPdf') as File;
    const xmlFile = formData.get('xmlFile') as File;

    if (!formularId || !kategorie || !blankPdf || !filledPdf || !xmlFile) {
      return NextResponse.json(
        { error: 'Alle Felder sind erforderlich' },
        { status: 400 }
      );
    }

    // Extrahiere id und kurz aus formularId
    const [id, ...kurzParts] = formularId.split('-');
    const kurz = kurzParts.join('-');

    // Pfad: formulare/{kategorie}/{formularId}/
    const baseDir = join(process.cwd(), '..', 'formulare');
    const formularPfad = `${kategorie}/${formularId}`;
    const formularDir = join(baseDir, formularPfad);
    const grundlagenDir = join(formularDir, 'grundlagen');
    const mappingsDir = join(formularDir, 'mappings');
    const exportsDir = join(formularDir, 'exports');

    // Erstelle Verzeichnisse
    await mkdir(grundlagenDir, { recursive: true });
    await mkdir(mappingsDir, { recursive: true });
    await mkdir(join(mappingsDir, 'auto-generated'), { recursive: true });
    await mkdir(join(mappingsDir, 'manual'), { recursive: true });
    await mkdir(exportsDir, { recursive: true });

    // Dateien speichern mit korrektem Namensschema
    const tplFileName = generateFileName(id, kurz, 'tpl', undefined, 'pdf');
    const demoFileName = generateFileName(id, kurz, 'demo', undefined, 'pdf');
    const demoXmlFileName = generateFileName(id, kurz, 'demo-xml', undefined, 'xml');

    await writeFile(join(grundlagenDir, tplFileName), Buffer.from(await blankPdf.arrayBuffer()));
    await writeFile(join(grundlagenDir, demoFileName), Buffer.from(await filledPdf.arrayBuffer()));
    await writeFile(join(grundlagenDir, demoXmlFileName), Buffer.from(await xmlFile.arrayBuffer()));

    // metadata.json erstellen
    const metadata = {
      id: formularId,
      formularnummer: id,
      name: formularId.split('-').slice(1).join(' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
      beschreibung: `Formular ${id}`,
      kategorie: kategorie,
      version: new Date().getFullYear().toString(),
      tags: [],
      status: "aktiv",
      erstellt: new Date().toISOString().split('T')[0],
      zuletztBearbeitet: new Date().toISOString().split('T')[0],
      mappingStatus: "fehlt"
    };

    await writeFile(
      join(formularDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf-8'
    );

    return NextResponse.json({
      success: true,
      formularId,
      kategorie,
      path: formularDir,
      files: {
        tpl: tplFileName,
        demo: demoFileName,
        demoXml: demoXmlFileName
      }
    });

  } catch (error: any) {
    return NextResponse.json(
      { error: `Fehler beim Erstellen: ${error.message}` },
      { status: 500 }
    );
  }
}

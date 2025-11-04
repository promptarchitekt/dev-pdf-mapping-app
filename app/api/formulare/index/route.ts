import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export async function GET() {
  try {
    // Lade Index aus formulare/_index.json (neue formular-zentrierte Struktur)
    const indexPath = join(process.cwd(), '..', 'formulare', '_index.json');

    try {
      const indexContent = await readFile(indexPath, 'utf-8');
      const index = JSON.parse(indexContent);
      return NextResponse.json(index);
    } catch (error: any) {
      // Falls Datei nicht existiert, erstelle leeren Index
      return NextResponse.json({
        version: "1.0",
        lastUpdated: new Date().toISOString(),
        formulare: []
      });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: `Fehler beim Laden des Index: ${error.message}` },
      { status: 500 }
    );
  }
}

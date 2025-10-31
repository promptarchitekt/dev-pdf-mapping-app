// Copies pdf.js worker from node_modules into public/ so we can reference /pdf.worker.min.js
const fs = require('fs');
const path = require('path');

function copy(srcPath, filename) {
  const dest = path.join(__dirname, '..', 'public', filename);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(srcPath, dest);
  console.log('[pdfjs] Copied worker →', dest);
}

try {
  // Try standard path first
  const resolved = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs');
  copy(resolved, 'pdf.worker.min.mjs');
} catch (e1) {
  try {
    // Fallback legacy path
    const resolved = require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.js');
    copy(resolved, 'pdf.worker.min.js');
  } catch (e2) {
    console.error('[pdfjs] Could not resolve pdf.worker.min.js', e1?.message || e1, e2?.message || e2);
    process.exit(1);
  }
}

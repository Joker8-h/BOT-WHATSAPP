const XLSX = require('xlsx');
const path = require('path');

async function debugWithSheetJS() {
  const filePath = path.join(__dirname, 'INV JUGUETES.xlsx');
  console.log('📊 Analizando con SheetJS:', filePath);

  const workbook = XLSX.readFile(filePath, { cellStyles: true, bookVBA: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  console.log('\n--- CELDA A2 (Ejemplo Juguete) ---');
  console.log(JSON.stringify(sheet['A2'], null, 2));

  console.log('\n--- VERIFICANDO METADATA DE IMÁGENES ---');
  // SheetJS almacena imágenes de forma distinta
  if (sheet['!drawings']) {
    console.log('Se detectaron dibujos (drawings) en la hoja.');
  } else {
    console.log('No se detectaron dibujos en la metadata de SheetJS.');
  }
}

debugWithSheetJS().catch(console.error);

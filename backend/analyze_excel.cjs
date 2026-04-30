const ExcelJS = require('exceljs');
const path = require('path');

async function analyzeExcel() {
  const filePath = path.join(__dirname, 'INV JUGUETES.xlsx');
  console.log('📊 Analizando:', filePath);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];

  console.log('\n--- COLUMNAS DETECTADAS (Fila 1) ---');
  const row1 = sheet.getRow(1);
  row1.eachCell((cell, colNumber) => {
    console.log(`Col ${colNumber}: "${cell.value}"`);
  });

  console.log('\n--- ANÁLISIS DE IMÁGENES ---');
  const images = sheet.getImages();
  console.log(`Total imágenes encontradas: ${images.length}`);

  if (images.length > 0) {
    for(let j=0; j<Math.min(5, images.length); j++) {
      const img = images[j];
      console.log(`Imagen ${j}: Row ${img.range.tl.nativeRow+1}, Col ${img.range.tl.nativeCol+1}`);
    }
  }

  console.log('\n--- DATOS DE LAS PRIMERAS 5 FILAS ---');
  for(let i=1; i<=5; i++) {
    const row = sheet.getRow(i);
    console.log(`Fila ${i}:`, row.values.slice(1, 7));
  }
}

analyzeExcel().catch(console.error);

const XLSX = require('xlsx');
const fs = require('fs');

function convertExcelToJson(inputFile, outputFile) {
    // Read the Excel file
    const workbook = XLSX.readFile(inputFile);
    
    // Get the first sheet
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Convert sheet to JSON using headers (first row) as keys
    const jsonData = XLSX.utils.sheet_to_json(sheet);
    
    // Write to JSON file
    fs.writeFileSync(outputFile, JSON.stringify(jsonData, null, 2));
    
    console.log(`Conversion complete! JSON file saved as ${outputFile}`);
}

// Check if file arguments are provided
if (process.argv.length < 4) {
    console.log('Usage: node excel_to_json.js <input_excel_file> <output_json_file>');
    process.exit(1);
}

const inputFile = process.argv[2];
const outputFile = process.argv[3];

// Verify input file exists
if (!fs.existsSync(inputFile)) {
    console.error(`Error: Input file "${inputFile}" does not exist`);
    process.exit(1);
}

try {
    convertExcelToJson(inputFile, outputFile);
} catch (error) {
    console.error('Error converting file:', error.message);
    process.exit(1);
} 
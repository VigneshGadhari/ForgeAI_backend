const express = require('express');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

function convertExcelToJson(filePath) {
    // Read the Excel/CSV file
    const workbook = XLSX.readFile(filePath);
    
    // Get the first sheet
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Convert sheet to JSON using headers (first row) as keys
    return XLSX.utils.sheet_to_json(sheet);
}

app.get('/api/agents', (req, res) => {
    try {
        const agentsDir = path.join(__dirname, 'src', 'dataProcessing', 'agents');
        const result = {};

        // Read all CSV files in the agents directory
        const files = fs.readdirSync(agentsDir).filter(file => file.endsWith('.csv'));

        files.forEach(file => {
            const filePath = path.join(agentsDir, file);
            const fileName = path.basename(file, '.csv'); // Remove .csv extension
            result[fileName] = convertExcelToJson(filePath);
        });

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Error processing files:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: err.message
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 
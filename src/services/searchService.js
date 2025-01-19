const { spawn } = require('child_process');
const path = require('path');

class SearchService {
    async searchTools(collectionName, query) {
        return new Promise((resolve, reject) => {
            // Determine Python executable
            const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
            const pythonScript = path.join(__dirname, '../dataProcessing/embeddings/search_tools.py');
            
            console.log('Executing Python script:', pythonScript);
            console.log('Parameters:', { collectionName, query });

            const pythonProcess = spawn(pythonCommand, [pythonScript, collectionName, query]);

            let dataString = '';
            let errorString = '';

            pythonProcess.stdout.on('data', (data) => {
                dataString += data.toString();
            });

            pythonProcess.stderr.on('data', (data) => {
                errorString += data.toString();
                console.error(`Python script error:`, data.toString());
            });

            pythonProcess.on('close', (code) => {
                if (code !== 0) {
                    console.error('Python process error details:', {
                        exitCode: code,
                        stderr: errorString,
                        stdout: dataString
                    });
                    return reject(new Error(`Python process failed with code ${code}: ${errorString}`));
                }

                try {
                    const jsonStartIndex = dataString.indexOf('{');
                    if (jsonStartIndex === -1) {
                        return reject(new Error('No JSON object found in Python script output'));
                    }

                    // Extract only the JSON part of the output
                    const jsonString = dataString.slice(jsonStartIndex);
                    
                    // Parse the JSON
                    const results = JSON.parse(jsonString);
                    if (results.error) {
                        return reject(new Error(results.error));
                    }
                    resolve(results);
                } catch (error) {
                    reject(new Error(`Failed to parse Python script output: ${error.message}\nOutput was: ${dataString}`));
                }
            });

            pythonProcess.on('error', (error) => {
                console.error('Failed to start Python process:', error);
                reject(new Error(`Failed to start Python process: ${error.message}`));
            });
        });
    }
}

module.exports = new SearchService(); 
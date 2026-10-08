const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config({ path: path.join(__dirname, '../.env') });
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("No GEMINI_API_KEY found in .env");
    process.exit(1);
}
const genAI = new GoogleGenerativeAI(apiKey);

const DATA_DIR = path.join(__dirname, '../data');
const MANUALS_DIR = path.join(DATA_DIR, 'manuals');
const MANUALS_INDEX_FILE = path.join(DATA_DIR, 'manuals_index.json');

if (!fs.existsSync(MANUALS_INDEX_FILE)) {
    fs.writeFileSync(MANUALS_INDEX_FILE, JSON.stringify({ chunks: [] }, null, 2));
}

let manualsCache = JSON.parse(fs.readFileSync(MANUALS_INDEX_FILE, 'utf8')).chunks || [];

async function getEmbedding(text) {
    const model = genAI.getGenerativeModel({ model: "gemini-embedding-2" });
    const result = await model.embedContent(text);
    return result.embedding.values;
}

async function run() {
    if (!fs.existsSync(MANUALS_DIR)) return;
    const files = fs.readdirSync(MANUALS_DIR);
    console.log(`Found ${files.length} files in manuals/`);

    for (const filename of files) {
        if (filename.startsWith('.')) continue; // ignore .DS_Store
        
        console.log(`Indexing ${filename}...`);
        // Remove existing chunks
        manualsCache = manualsCache.filter(c => c.filename !== filename);

        const filePath = path.join(MANUALS_DIR, filename);
        let text = '';
        const ext = path.extname(filename).toLowerCase();
        
        try {
            if (ext === '.pdf') {
                const dataBuffer = fs.readFileSync(filePath);
                const data = await pdfParse(dataBuffer);
                text = data.text;
            } else if (ext === '.docx') {
                const result = await mammoth.extractRawText({ path: filePath });
                text = result.value;
            } else {
                text = fs.readFileSync(filePath, 'utf8');
            }

            const paragraphs = text.split(/\n\s*\n/);
            const chunks = [];
            
            let currentChunk = '';
            for (const p of paragraphs) {
                const trimmed = p.trim();
                if (!trimmed) continue;
                
                if (currentChunk.length + trimmed.length < 1000) {
                    currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
                } else {
                    if (currentChunk) chunks.push(currentChunk);
                    currentChunk = trimmed;
                }
            }
            if (currentChunk) chunks.push(currentChunk);

            console.log(`Generating vectors for ${chunks.length} chunks from ${filename}...`);
            for (let i = 0; i < chunks.length; i++) {
                try {
                    const embedding = await getEmbedding(chunks[i]);
                    manualsCache.push({
                        id: uuidv4(),
                        filename: filename,
                        text: chunks[i],
                        embedding: embedding
                    });
                } catch (embErr) {
                    console.error(`Error embedding chunk ${i}:`, embErr.message);
                }
            }
        } catch (e) {
            console.error(`Error processing file ${filename}:`, e.message);
        }
        
        fs.writeFileSync(MANUALS_INDEX_FILE, JSON.stringify({ chunks: manualsCache }, null, 2));
    }
    
    console.log("Finished indexing existing manuals.");
}

run();

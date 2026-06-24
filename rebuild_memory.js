require('dotenv').config();
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { v4: uuidv4 } = require('uuid');

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("No API key found in .env");
  process.exit(1);
}

const MEMORY_FILE = 'data/memory.json';

function chunkText(text, maxChars = 3000, overlap = 500) {
  if (!text) return [];
  const chunks = [];
  let startIndex = 0;
  while (startIndex < text.length) {
    let endIndex = startIndex + maxChars;
    if (endIndex < text.length) {
      const lastSpace = text.lastIndexOf(' ', endIndex);
      if (lastSpace > startIndex + maxChars / 2) {
        endIndex = lastSpace;
      }
    } else {
      endIndex = text.length;
    }
    chunks.push(text.substring(startIndex, endIndex).trim());
    if (endIndex >= text.length) {
      break;
    }
    startIndex = endIndex - overlap;
  }
  return chunks.filter(c => c.length > 20);
}

async function getEmbeddingWithRetry(text, apiKey, retries = 3, delay = 2000) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-2" });
  for (let i = 0; i < retries; i++) {
    try {
      const result = await model.embedContent(text);
      return result.embedding.values;
    } catch (error) {
      if (i === retries - 1) throw error;
      console.warn(`Embedding failed, retrying in ${delay}ms...`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

async function rebuild() {
  console.log("Starting rebuild of memory.json from BrainSave.html...");
  if (!fs.existsSync('BrainSave.html')) {
    console.error("BrainSave.html not found.");
    return;
  }
  
  const htmlContent = fs.readFileSync('BrainSave.html', 'utf8');
  console.log("Read HTML file. Parsing...");
  
  const textOnly = htmlContent
      .replace(/<head>([\s\S]*?)<\/head>/gi, '')
      .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
      .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
      
  console.log("Stripped HTML. Text length:", textOnly.length);
  
  const chunks = chunkText(textOnly, 3000, 500);
  console.log(`Generated ${chunks.length} chunks. Starting embeddings...`);
  
  const memories = [];
  const batchSize = 10;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const promises = batch.map(async (chunk) => {
      try {
        const embedding = await getEmbeddingWithRetry(chunk, API_KEY);
        return {
          id: uuidv4(),
          text: chunk,
          embedding,
          metadata: {
            source: 'BrainSave.html',
            timestamp: new Date().toISOString()
          }
        };
      } catch (err) {
        return null;
      }
    });
    
    const embeddedBatch = (await Promise.all(promises)).filter(x => x !== null);
    memories.push(...embeddedBatch);
    console.log(`Processed ${Math.min(i + batchSize, chunks.length)} / ${chunks.length}`);
    
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ vectors: memories }, null, 2));
    
    if (i + batchSize < chunks.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  console.log("Rebuild complete. memory.json saved.");
}

rebuild();

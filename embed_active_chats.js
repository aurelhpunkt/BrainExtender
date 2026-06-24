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
const CHATS_FILE = 'data/chats.json';

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

async function embedActiveChats() {
  console.log("Starting embedding of active chats from chats.json...");
  if (!fs.existsSync(CHATS_FILE)) {
    console.error("chats.json not found.");
    return;
  }
  
  let memoryData = { vectors: [] };
  if (fs.existsSync(MEMORY_FILE)) {
    memoryData = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  }
  
  const chatsData = JSON.parse(fs.readFileSync(CHATS_FILE, 'utf8'));
  const chats = chatsData.chats || [];
  
  console.log(`Found ${chats.length} active chats.`);
  
  let totalChunks = [];
  
  for (const chat of chats) {
    if (!chat.messages || chat.messages.length === 0) continue;
    
    // Concatenate all messages in this chat to form the full conversation context
    const fullConversation = chat.messages.map(m => {
      const roleName = m.role === 'user' ? 'User' : 'KI';
      return `${roleName}: ${m.content}`;
    }).join('\n\n');
    
    const chunks = chunkText(fullConversation, 3000, 500);
    
    for (const chunk of chunks) {
      totalChunks.push({
        text: `Chat-Kontext aus "${chat.title}":\n` + chunk,
        source: `chat_${chat.id}`,
        timestamp: chat.updatedAt || chat.createdAt || new Date().toISOString()
      });
    }
  }
  
  console.log(`Generated ${totalChunks.length} chunks from active chats. Starting embeddings...`);
  
  const memories = memoryData.vectors;
  const batchSize = 10;
  
  for (let i = 0; i < totalChunks.length; i += batchSize) {
    const batch = totalChunks.slice(i, i + batchSize);
    const promises = batch.map(async (item) => {
      try {
        const embedding = await getEmbeddingWithRetry(item.text, API_KEY);
        return {
          id: uuidv4(),
          text: item.text,
          embedding,
          metadata: {
            source: item.source,
            timestamp: item.timestamp
          }
        };
      } catch (err) {
        return null;
      }
    });
    
    const embeddedBatch = (await Promise.all(promises)).filter(x => x !== null);
    memories.push(...embeddedBatch);
    console.log(`Processed ${Math.min(i + batchSize, totalChunks.length)} / ${totalChunks.length}`);
    
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ vectors: memories }, null, 2));
    
    if (i + batchSize < totalChunks.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  console.log("Active chats embedding complete. memory.json saved.");
}

embedActiveChats();

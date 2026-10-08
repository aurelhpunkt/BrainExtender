require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("No GEMINI_API_KEY found");
    return;
  }
  
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  
  const data = JSON.parse(fs.readFileSync('data/chats.json', 'utf8'));
  const coachChat = data.chats.find(c => c.title && c.title.toLowerCase().includes("beziehung") || c.role === "beziehungs_coach" || (c.role && c.role.toLowerCase().includes("coach")));
  
  if (!coachChat) {
    console.error("Coach chat not found.");
    return;
  }
  
  let compressedChat = "";
  for (const m of coachChat.messages) {
    const text = m.content || "";
    if (text.length > 200) {
      compressedChat += `[${m.role.toUpperCase()}] (${m.timestamp}):\n${text}\n\n`;
    }
  }
  
  console.log(`Compressed chat length: ${compressedChat.length} chars`);
  
  const chunkSize = 3000000;
  const chunks = [];
  for (let i = 0; i < compressedChat.length; i += chunkSize) {
    chunks.push(compressedChat.slice(i, i + chunkSize));
  }
  
  let finalSummary = "";
  for (let i = 0; i < chunks.length; i++) {
    console.log(`Processing chunk ${i+1}/${chunks.length}...`);
    const prompt = `Lies diesen Teil eines sehr langen Chatverlaufs zwischen dem Nutzer (Aurel) und seinem Beziehungs-Coach (KI).
Extrahiere die wichtigsten Kernerkenntnisse, psychologischen Einsichten und konkreten Handlungsempfehlungen, die sich in diesem Teil des Chats herauskristallisiert haben.
Achte besonders darauf, wie sich die Erkenntnisse iterativ geschärft haben.

Schreibe eine sehr detaillierte Zusammenfassung der "Lehren" dieses Chat-Teils.

CHAT-TEIL:
${chunks[i]}`;

    try {
      const result = await model.generateContent(prompt);
      finalSummary += `\n\n--- TEIL ${i+1} ---\n` + result.response.text();
      console.log(`Chunk ${i+1} done.`);
    } catch (e) {
      console.error(`Error processing chunk ${i+1}:`, e.message);
    }
  }
  
  fs.writeFileSync('scratch/coach_insights.txt', finalSummary);
  console.log("Done! Saved to scratch/coach_insights.txt");
}

run();

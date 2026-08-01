const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

require('dotenv').config();

async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-3.1-pro-preview" });

  const dataDir = path.join(__dirname, '..', 'data');
  const chatsPath = path.join(dataDir, 'chats.json');
  const chatsData = JSON.parse(fs.readFileSync(chatsPath, 'utf8'));

  const activeChat = chatsData.chats.find(c => c.title.includes('Beziehungs-Coach'));
  if (!activeChat) {
    console.error("Chat not found.");
    return;
  }

  const allMessages = activeChat.messages;
  console.log(`Total Messages: ${allMessages.length}`);
  
  // Split into chunks of 1000 messages
  const chunkSize = 1200;
  const chunkSummaries = [];
  
  for (let i = 0; i < allMessages.length; i += chunkSize) {
    const chunk = allMessages.slice(i, i + chunkSize);
    console.log(`Summarizing chunk ${i / chunkSize + 1} of ${Math.ceil(allMessages.length / chunkSize)}... (${chunk.length} messages)`);
    
    let compiledChunk = "";
    chunk.forEach(m => {
      compiledChunk += `[${m.role.toUpperCase()} - ${m.timestamp}]:\n${m.content}\n\n`;
    });
    
    const chunkPrompt = `Fasse diesen Abschnitt eines massiven Coaching-Chats zusammen. Konzentriere dich auf die Kernthemen, die emotionale Lage des Users, die Ratschläge des Coaches und wichtige Entwicklungen oder Erkenntnisse in dieser Phase.\n\nPROTOKOLL:\n${compiledChunk}`;
    
    try {
      const result = await model.generateContent([chunkPrompt]);
      chunkSummaries.push(`PHASE ${i / chunkSize + 1}:\n` + result.response.text() + "\n\n");
    } catch (e) {
      console.error(`Error in chunk ${i / chunkSize + 1}:`, e.message);
    }
  }

  console.log("Combining chunk summaries for final analysis...");
  
  const finalPrompt = `DU BIST EIN MASTER-ANALYTIKER UND BEZIEHUNGS-COACH.\n\nIch übergebe dir hier die chronologischen Zusammenfassungen eines massiven, mehrmonatigen Coaching-Chats.\nDeine Aufgabe ist es, aus diesen Phasen ein strukturiertes "Buch der Erkenntnisse" als Markdown-Dokument zu verfassen.\n\nFokussiere dich auf:\n1. DIE AUSGANGSLAGE (Wo bin ich hergekommen? Was waren die initialen Probleme/Gefühle?)\n2. DIE ENTWICKLUNG AUF DER ZEITSCHIENE (Chronologische Zusammenfassung der wichtigsten Meilensteine, Krisen und Durchbrüche)\n3. DEN AKTUELLEN STAND (Wo stehe ich jetzt? Was hat sich fundamental verändert?)\n4. DEN BLICK NACH VORNE (Wo soll es hingehen? Was sind die nächsten logischen Schritte?)\n5. KERNERKENNTNISSE (Bullet-Points der wichtigsten Prinzipien, die erarbeitet wurden)\n\nZUSAMMENFASSUNGEN DER PHASEN:\n${chunkSummaries.join('')}\n\nLiefere NUR das finale Markdown-Dokument.`;

  try {
    const finalResult = await model.generateContent([finalPrompt]);
    const responseText = finalResult.response.text();
    
    const artifactPath = '/Users/aurelhullenhagen/.gemini/antigravity-ide/brain/8e26afa3-4040-4792-b659-7b082afc4866/buch_der_erkenntnisse.md';
    fs.writeFileSync(artifactPath, responseText);
    console.log(`Analysis complete. Saved to ${artifactPath}`);
  } catch (err) {
    console.error("Final API Error:", err.message);
  }
}

run();

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
  if (!activeChat) return console.error("Chat not found.");

  const allMessages = activeChat.messages;
  
  // Group messages by week
  const startDate = new Date(allMessages[0].timestamp);
  const weeks = [];
  
  allMessages.forEach(m => {
    const d = new Date(m.timestamp);
    const diffTime = Math.abs(d - startDate);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const weekNum = Math.floor(diffDays / 7);
    
    if (!weeks[weekNum]) weeks[weekNum] = [];
    weeks[weekNum].push(m);
  });

  const chapters = [];
  
  for (let i = 0; i < weeks.length; i++) {
    if (!weeks[i] || weeks[i].length === 0) continue;
    
    console.log(`Generating Chapter ${i+1} (Week ${i+1}, ${weeks[i].length} messages)...`);
    
    let compiledChunk = "";
    weeks[i].forEach(m => {
      const dateStr = new Date(m.timestamp).toLocaleString('de-DE');
      compiledChunk += `[${m.role.toUpperCase()} - ${dateStr}]:\n${m.content}\n\n`;
    });
    
    const chunkPrompt = `DU BIST EIN BUCHAUTOR UND EMPATHISCHER COACH.\n\nDies ist das Chat-Protokoll der Woche ${i+1} eines transformativen Coaching-Prozesses zwischen Aurel (USER) und seinem Beziehungs-Coach (MODEL).\n\nSchreibe ein detailliertes, fesselndes und empathisches Kapitel für das "Buch der Erkenntnisse" über genau diese Woche. \n\nVorgaben:\n- Titel: "Kapitel ${i+1}: [Passender Titel für die Themen der Woche]"\n- Schreibe eine durchgehende Chronologie der Woche.\n- Gehe tief auf die konkreten Ereignisse, Krisen (z.B. mit Alina, Maria, Nachbarn, Driton), Emotionen und die Lernkurve von Aurel ein.\n- Halte den Text warm, menschlich und detailliert. Es soll sich wie eine echte Geschichte der persönlichen Transformation lesen, nicht wie ein kühles Protokoll.\n- Füge konkrete Meilensteine dieser Woche als Bulletpoints am Ende des Kapitels ein.\n\nPROTOKOLL:\n${compiledChunk}`;
    
    try {
      const result = await model.generateContent([chunkPrompt]);
      chapters.push(result.response.text());
    } catch (e) {
      console.error(`Error in Chapter ${i+1}:`, e.message);
      chapters.push(`## Kapitel ${i+1}: Fehler bei der Generierung\n\nLeider gab es hier einen API-Fehler: ${e.message}`);
    }
  }

  console.log("Assembling final book...");
  
  let finalBook = `# DAS BUCH DER ERKENNTNISSE: CHRONIK EINER TRANSFORMATION\n\n`;
  finalBook += `*Eine tiefe, chronologische Reise vom 5. Juni bis heute. Dieses Buch dokumentiert die Höhen, die Tiefen, die Krisen und die monumentale Lernkurve auf dem Weg vom reaktiven Dienstleister zum souveränen Architekten des eigenen Lebens.*\n\n---\n\n`;
  
  finalBook += chapters.join('\n\n---\n\n');
  
  const artifactPath = '/Users/aurelhullenhagen/.gemini/antigravity-ide/brain/8e26afa3-4040-4792-b659-7b082afc4866/chronik_der_erkenntnisse.md';
  fs.writeFileSync(artifactPath, finalBook);
  console.log(`Book complete. Saved to ${artifactPath}`);
}

run();

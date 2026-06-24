require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
const DEADLINES_FILE = path.join(DATA_DIR, 'deadlines.json');

function loadJson(file, defaultVal = []) {
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      return defaultVal;
    }
  }
  return defaultVal;
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function run() {
  console.log("Starte initialen Full-Scan des gesamten Speichers...");
  const apiKey = process.env.GEMINI_API_KEY;
  const genAI = new GoogleGenerativeAI(apiKey);
  // Wir nutzen Flash, weils für pure Info-Extraktion extrem gut und günstig ist
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  let memoriesData = loadJson(MEMORY_FILE, { vectors: [] });
  const memories = Array.isArray(memoriesData) ? memoriesData : (memoriesData.vectors || []);
  
  if (memories.length === 0) {
    console.log("Kein Gedächtnis gefunden.");
    return;
  }

  // Teile die Erinnerungen in Chunks auf, falls es zu viele sind
  const chunkSize = 20;
  const deadlines = loadJson(DEADLINES_FILE, []);

  for (let i = 0; i < memories.length; i += chunkSize) {
    const chunk = memories.slice(i, i + chunkSize);
    console.log(`Analysiere Chunk ${i/chunkSize + 1} von ${Math.ceil(memories.length/chunkSize)}...`);
    
    const prompt = `
Du bist ein Datenextraktions-Skript.
Lies die folgenden Chat-Erinnerungen.
Gibt es darin harte Fristen, Deadlines oder gesetzte Zahlungsziele (z.B. "Ich habe ihm eine Frist von 14 Tagen gesetzt", "Muss bis Freitag bezahlt sein")?
Wenn ja, extrahiere sie als JSON-Array in diesem exakten Format:
[
  { "title": "Frist XY", "dueDate": "YYYY-MM-DD", "context": "Kurze Beschreibung" }
]
Wenn es keine Fristen gibt, antworte NUR mit: []

Erinnerungen:
${chunk.map(m => "- " + m.text).join('\n')}
`;
    
    try {
      const result = await model.generateContent(prompt);
      let text = result.response.text().trim();
      if (text.startsWith('```json')) text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      if (text.startsWith('```')) text = text.replace(/```/g, '').trim();
      
      const extracted = JSON.parse(text);
      if (Array.isArray(extracted) && extracted.length > 0) {
        extracted.forEach(d => {
          d.id = uuidv4();
          d.createdAt = new Date().toISOString();
          deadlines.push(d);
        });
      }
    } catch(e) {
      console.log("Keine verwertbaren Daten in diesem Chunk oder Parse-Fehler.");
    }
  }

  saveJson(DEADLINES_FILE, deadlines);
  console.log(`Scan abgeschlossen. ${deadlines.length} Fristen gefunden.`);
}

run();

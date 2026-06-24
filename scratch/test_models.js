const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("API-Key nicht in .env gefunden.");
    return;
  }
  
  const genAI = new GoogleGenerativeAI(apiKey);
  
  try {
    console.log("1. Teste Einbettungs-Modell (gemini-embedding-2)...");
    const embedModel = genAI.getGenerativeModel({ model: "gemini-embedding-2" });
    const embedResult = await embedModel.embedContent("Dies ist ein Test.");
    console.log("Einbettung erfolgreich! Dimensionen:", embedResult.embedding.values.length);
    
    console.log("\n2. Teste Generierungs-Modell (gemini-2.5-flash)...");
    const chatModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const chatResult = await chatModel.generateContent("Sag 'Hallo' auf Deutsch.");
    console.log("Antwort:", chatResult.response.text());
    
    console.log("\n=== ALLE TESTS ERFOLGREICH! ===");
  } catch (err) {
    console.error("Test fehlgeschlagen:", err);
  }
}

run();

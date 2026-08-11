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

  // Filter ONLY user messages
  const userMessages = activeChat.messages.filter(m => m.role === 'user');
  
  // Group user messages by week
  const startDate = new Date(userMessages[0].timestamp);
  const weeks = [];
  
  userMessages.forEach(m => {
    const d = new Date(m.timestamp);
    const diffTime = Math.abs(d - startDate);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const weekNum = Math.floor(diffDays / 7);
    
    if (!weeks[weekNum]) weeks[weekNum] = [];
    weeks[weekNum].push(m);
  });

  const weeklyAnalyses = [];
  
  for (let i = 0; i < weeks.length; i++) {
    if (!weeks[i] || weeks[i].length === 0) continue;
    
    console.log(`Analyzing Patterns for Week ${i+1} (${weeks[i].length} user messages)...`);
    
    let compiledChunk = "";
    weeks[i].forEach(m => {
      const dateStr = new Date(m.timestamp).toLocaleString('de-DE');
      compiledChunk += `[${dateStr}]:\n${m.content}\n\n`;
    });
    
    const chunkPrompt = `DU BIST EIN VERHALTENSPSYCHOLOGE UND LINGUIST.\n\nDies sind ausschließlich die TAGEBUCH-EINGABEN und NACHRICHTEN von Aurel aus der Woche ${i+1} eines mehrmonatigen Zeitraums.\n\nAnalysiere diese rohen Eingaben auf Verhaltensmuster, Denkmuster, emotionale Trigger und sprachliche Auffälligkeiten in dieser spezifischen Woche.\nFokussiere dich auf:\n1. Emotionale Grundstimmung\n2. Reaktive vs. Proaktive Denkmuster\n3. Wiederkehrende Trigger (z.B. Verlustangst, Drang zur Problemlösung, Harmoniesucht)\n4. Linguistic Cues (Häufige Formulierungen wie "ich muss", "es tut mir leid", "ich versuche")\n\nFasse deine Beobachtungen für diese Woche prägnant in Stichpunkten und kurzen Absätzen zusammen.\n\nPROTOKOLL:\n${compiledChunk}`;
    
    try {
      const result = await model.generateContent([chunkPrompt]);
      weeklyAnalyses.push(`## Analyse Woche ${i+1}:\n` + result.response.text());
    } catch (e) {
      console.error(`Error in Week ${i+1}:`, e.message);
      weeklyAnalyses.push(`## Analyse Woche ${i+1}: Fehler bei der Generierung\n\n${e.message}`);
    }
  }

  console.log("Synthesizing final pattern analysis...");
  
  const finalPrompt = `DU BIST EIN MASTER-PSYCHOLOGE UND VERHALTENSANALYTIKER.\n\nIch übergebe dir hier die wöchentlichen Muster-Analysen der Tagebuch-Eingaben von Aurel über die letzten 2 Monate.\nDeine Aufgabe ist es, aus diesen isolierten Wochenberichten eine gigantische META-ANALYSE als formatiertes Markdown-Dokument zu erstellen.\n\nFokussiere dich auf:\n1. DOMINANTE UR-MUSTER (Welche toxischen/einschränkenden Muster waren zu Beginn omnipräsent?)\n2. DIE SHIFTS (Wie und wann haben sich diese Muster verändert? Wo fand der Umschwung von reaktiv zu proaktiv statt?)\n3. LINGUISTISCHE TRANSFORMATION (Wie hat sich seine Art zu schreiben/denken verändert? Z.B. von "ich muss sie retten" zu "ich setze meine Grenzen")\n4. NEUE MUSTER (Welche neuen, gesunden Verhaltensmuster haben sich manifestiert?)\n5. BLINDE FLECKEN (Gibt es Rest-Muster, die immer noch zyklisch auftauchen und auf die er achten muss?)\n\nNutze Zitate (falls impliziert), klare Überschriften, Bullet-Points und Tabellen, um die Musterveränderungen visuell und strukturell brillant aufzubereiten.\n\nWÖCHENTLICHE ANALYSEN:\n${weeklyAnalyses.join('\n\n---\n\n')}\n\nLiefere NUR das finale Markdown-Dokument.`;
  
  try {
    const finalResult = await model.generateContent([finalPrompt]);
    const responseText = finalResult.response.text();
    
    const artifactPath = '/Users/aurelhullenhagen/.gemini/antigravity-ide/brain/8e26afa3-4040-4792-b659-7b082afc4866/musteranalyse.md';
    fs.writeFileSync(artifactPath, responseText);
    console.log(`Pattern analysis complete. Saved to ${artifactPath}`);
  } catch (err) {
    console.error("Final API Error:", err.message);
  }
}

run();

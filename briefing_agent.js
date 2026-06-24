const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, 'data');
const TODOS_FILE = path.join(DATA_DIR, 'todos.json');
const APPOINTMENTS_FILE = path.join(DATA_DIR, 'appointments.json');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const DEADLINES_FILE = path.join(DATA_DIR, 'deadlines.json');

// --- Helpers ---
function loadJson(file, defaultVal = []) {
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      console.error(`Error parsing ${file}:`, e);
      return defaultVal;
    }
  }
  return defaultVal;
}

function saveJson(file, data) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`Error saving ${file}:`, e);
  }
}

// Ensure the "Protokollant" chat exists
function getOrSetupProtokollantChat() {
  const data = loadJson(CHATS_FILE, { chats: [] });
  const chats = Array.isArray(data) ? data : (data.chats || []);
  let protokollantChat = chats.find(c => c.isProtokollant);
  
  if (!protokollantChat) {
    protokollantChat = {
      id: "protokollant-" + uuidv4().substring(0, 8),
      title: "System-Protokollant",
      role: "it_expert",
      tone: "neutral",
      model: "gemini-2.5-flash",
      isProtokollant: true,
      createdAt: new Date().toISOString(),
      messages: [
        {
          id: uuidv4(),
          role: "model",
          content: "Ich bin dein automatischer System-Protokollant. Ich werde hier täglich die wichtigsten Fristen, ToDos und Termine für dich zusammenfassen.",
          timestamp: new Date().toISOString()
        }
      ]
    };
    chats.push(protokollantChat);
    saveJson(CHATS_FILE, { chats: chats });
  }
  return protokollantChat;
}

function injectMessage(content) {
  const data = loadJson(CHATS_FILE, { chats: [] });
  const chats = Array.isArray(data) ? data : (data.chats || []);
  const protokollantIndex = chats.findIndex(c => c.isProtokollant);
  
  if (protokollantIndex !== -1) {
    chats[protokollantIndex].messages.push({
      id: uuidv4(),
      role: "model",
      content: content,
      timestamp: new Date().toISOString()
    });
    saveJson(CHATS_FILE, { chats: chats });
    console.log("[Protokollant] Neue Nachricht im System-Chat hinterlegt.");
  } else {
    // If it doesn't exist, create it and inject again
    getOrSetupProtokollantChat();
    injectMessage(content);
  }
}

// --- Phase 1: Nightly Scanner (Delta) ---
// Extrahiert harte Fristen aus neuen Chat-Verläufen / Erinnerungen
async function runNightlyScanner(apiKey) {
  console.log("[Protokollant] Starte nächtlichen Scanner (Phase 1)...");
  try {
    let memoriesData = loadJson(MEMORY_FILE, { vectors: [] });
    const memories = Array.isArray(memoriesData) ? memoriesData : (memoriesData.vectors || []);
    const deadlines = loadJson(DEADLINES_FILE, []);
    
    // Find memories from the last 24 hours
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentMemories = memories.filter(m => m.metadata && m.metadata.createdAt && new Date(m.metadata.createdAt) >= yesterday);
    
    if (recentMemories.length === 0) {
      console.log("[Protokollant] Keine neuen Erinnerungen gefunden. Scanner beendet.");
      return;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    // Using a fast, cheap model for data extraction
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    const prompt = `
Du bist ein Datenextraktions-Skript.
Lies die folgenden Chat-Erinnerungen der letzten 24 Stunden.
Gibt es darin harte Fristen, Deadlines oder gesetzte Zahlungsziele (z.B. "Ich habe ihm eine Frist von 14 Tagen gesetzt", "Muss bis Freitag bezahlt sein")?
Wenn ja, extrahiere sie als JSON-Array in diesem exakten Format:
[
  { "title": "Frist XY", "dueDate": "YYYY-MM-DD", "context": "Kurze Beschreibung" }
]
Wenn es keine Fristen gibt, antworte NUR mit: []

Erinnerungen:
${recentMemories.map(m => "- " + m.text).join('\n')}
`;

    const result = await model.generateContent(prompt);
    let text = result.response.text().trim();
    
    // Try to parse JSON from the response
    if (text.startsWith('```json')) text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    if (text.startsWith('```')) text = text.replace(/```/g, '').trim();

    try {
      const extractedDeadlines = JSON.parse(text);
      if (Array.isArray(extractedDeadlines) && extractedDeadlines.length > 0) {
        // Append new deadlines with generation timestamp
        extractedDeadlines.forEach(d => {
          d.id = uuidv4();
          d.createdAt = new Date().toISOString();
          deadlines.push(d);
        });
        saveJson(DEADLINES_FILE, deadlines);
        console.log(`[Protokollant] ${extractedDeadlines.length} neue Fristen extrahiert und gespeichert.`);
      } else {
        console.log("[Protokollant] Keine neuen Fristen in den Erinnerungen gefunden.");
      }
    } catch (parseErr) {
      console.error("[Protokollant] Fehler beim Parsen der extrahierten Fristen:", text);
    }
    
  } catch (err) {
    console.error("[Protokollant] Fehler im nächtlichen Scanner:", err);
  }
}

// --- Phase 2: Morning Briefing ---
async function runMorningBriefing(apiKey) {
  console.log("[Protokollant] Starte Morning Briefing (Phase 2)...");
  try {
    const todos = loadJson(TODOS_FILE).filter(t => !t.completed);
    const appointments = loadJson(APPOINTMENTS_FILE);
    const deadlines = loadJson(DEADLINES_FILE);

    // Filter appointments (only keep past missing ones or near future)
    const today = new Date();
    today.setHours(0,0,0,0);
    const inSevenDays = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const activeAppointments = appointments.filter(a => {
      const d = new Date(a.date);
      // Keep appointments from the past 3 days and next 7 days
      const threeDaysAgo = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);
      return d >= threeDaysAgo && d <= inSevenDays;
    });

    // Check deadlines (only keep uncompleted deadlines)
    // For simplicity right now, we just pass all deadlines and let the AI judge if they are overdue.
    // In a mature system, we'd add "completed" flags to deadlines too.

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Fast & cost-effective

    const systemPrompt = `
Du bist der "Draufblick", der unbestechliche Protokollant und Assistent für Aurel Hüllenhagen.
Es ist heute der ${new Date().toLocaleDateString('de-DE')}.

Deine Aufgabe:
Schreibe ein kurzes, extrem auf den Punkt gebrachtes Tages-Briefing für Aurel.
Ignoriere alles, was noch weit in der Zukunft liegt oder längst irrelevant ist.
Fokussiere dich auf:
1. GESTRIGE/ÜBERFÄLLIGE DINGE: Mahnverfahren, Fristen, die gestern ausgelaufen sind?
2. HEUTE: Was ist heute zwingend auf der Agenda?
3. NÄCHSTE TAGE: Welche großen Brocken werfen ihre Schatten voraus?
4. OFFENE TODOS: Eine knallharte 80/20 Priorisierung der offenen Aufgaben. Welches ToDo hat den größten Hebel?

Sei direkt, kaufmännisch, ohne langes "Guten Morgen" Geschwafel. Verwende Bulletpoints.

Hier sind die aktuellen Daten aus dem System:

--- OFFENE TODOS ---
${todos.length > 0 ? JSON.stringify(todos, null, 2) : 'Keine offenen ToDos.'}

--- AKTUELLE TERMINE (Nahbereich) ---
${activeAppointments.length > 0 ? JSON.stringify(activeAppointments, null, 2) : 'Keine relevanten Termine.'}

--- EXTRAHIERTE FRISTEN ---
${deadlines.length > 0 ? JSON.stringify(deadlines, null, 2) : 'Keine manuell extrahierten Fristen.'}
`;

    const result = await model.generateContent(systemPrompt);
    const text = result.response.text();

    injectMessage(text);
    console.log("[Protokollant] Morning Briefing erfolgreich generiert.");

  } catch (err) {
    console.error("[Protokollant] Fehler beim Morning Briefing:", err);
  }
}

// --- Initialization ---
function initProtokollant() {
  const protokollantChat = getOrSetupProtokollantChat();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[Protokollant] Kein API Key gefunden. Cron-Jobs werden nicht gestartet.");
    return;
  }

  // Phase 1: Nightly Scanner at 03:00 AM
  cron.schedule('0 3 * * *', () => {
    runNightlyScanner(process.env.GEMINI_API_KEY);
  });

  // Phase 2: Morning Briefing at 07:00 AM
  cron.schedule('0 7 * * *', () => {
    runMorningBriefing(process.env.GEMINI_API_KEY);
  });

  console.log("[Protokollant] Cron-Jobs für Scanner (03:00) und Briefing (07:00) initialisiert.");

  // Catch-up logic for sleeping MacBooks
  // If the server starts and we haven't posted a briefing today, run it now.
  if (protokollantChat && protokollantChat.messages && protokollantChat.messages.length > 0) {
    const lastMsg = protokollantChat.messages[protokollantChat.messages.length - 1];
    const lastMsgDate = new Date(lastMsg.timestamp);
    const today = new Date();
    if (lastMsgDate.getDate() !== today.getDate() || lastMsgDate.getMonth() !== today.getMonth() || lastMsgDate.getFullYear() !== today.getFullYear()) {
      console.log("[Protokollant] MacBook hat scheinbar geschlafen. Hole Morning-Briefing für heute nach...");
      // Run scanner to catch up on last 24h just in case
      runNightlyScanner(process.env.GEMINI_API_KEY).then(() => {
        runMorningBriefing(process.env.GEMINI_API_KEY);
      });
    }
  } else {
    // If no messages at all, run it.
    runNightlyScanner(process.env.GEMINI_API_KEY).then(() => {
      runMorningBriefing(process.env.GEMINI_API_KEY);
    });
  }
}

module.exports = {
  initProtokollant,
  runNightlyScanner, // Exported for manual testing
  runMorningBriefing // Exported for manual testing
};

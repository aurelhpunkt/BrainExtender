const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const DATA_DIR = path.join(__dirname, 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
const LEVERS_FILE = path.join(DATA_DIR, 'levers.json');

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

async function runLeverExtractor(apiKey, isFullScan = false) {
  console.log(`[LeverExtractor] Starte Analyse... (FullScan: ${isFullScan})`);
  try {
    let memoriesData = loadJson(MEMORY_FILE, { vectors: [] });
    let memories = Array.isArray(memoriesData) ? memoriesData : (memoriesData.vectors || []);
    
    if (memories.length === 0) {
      console.log("[LeverExtractor] Keine Erinnerungen gefunden. Abbruch.");
      return;
    }

    // Sort chronologically (oldest to newest)
    memories.sort((a, b) => {
      const dateA = (a.metadata && a.metadata.createdAt) ? new Date(a.metadata.createdAt).getTime() : 0;
      const dateB = (b.metadata && b.metadata.createdAt) ? new Date(b.metadata.createdAt).getTime() : 0;
      return dateA - dateB;
    });

    let relevantMemories = memories;
    if (!isFullScan) {
      // Fast weekly scan
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      relevantMemories = memories.filter(m => {
        if (!m.metadata || !m.metadata.createdAt) return true;
        return new Date(m.metadata.createdAt) >= thirtyDaysAgo;
      });
      console.log(`[LeverExtractor] Filtere auf die letzten 30 Tage. Übrig: ${relevantMemories.length} von ${memories.length} Erinnerungen.`);
      
      const MAX_MEMORIES = 1500;
      if (relevantMemories.length > MAX_MEMORIES) {
        console.log(`[LeverExtractor] Begrenze auf die neuesten ${MAX_MEMORIES} Erinnerungen.`);
        relevantMemories = relevantMemories.slice(-MAX_MEMORIES);
      }
    } else {
      console.log(`[LeverExtractor] Full Scan (Map-Reduce): Verarbeite alle ${memories.length} Erinnerungen.`);
    }

    if (relevantMemories.length === 0) {
      console.log("[LeverExtractor] Keine relevanten Erinnerungen im gewählten Zeitraum. Abbruch.");
      return;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    let finalPrompt = "";

    if (isFullScan) {
      // MAP PHASE: Chunk into blocks of ~500
      const CHUNK_SIZE = 500;
      const chunks = [];
      for (let i = 0; i < relevantMemories.length; i += CHUNK_SIZE) {
        chunks.push(relevantMemories.slice(i, i + CHUNK_SIZE));
      }

      console.log(`[LeverExtractor] Map-Phase: Zerteilt in ${chunks.length} Blöcke. Starte Einzelanalysen...`);
      const chunkSummaries = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        // Extract start and end date for context
        const start = chunk[0]?.metadata?.createdAt || "Unbekannt";
        const end = chunk[chunk.length-1]?.metadata?.createdAt || "Unbekannt";
        
        console.log(`[LeverExtractor] Analysiere Block ${i+1}/${chunks.length} (${start} bis ${end})...`);
        
        const contextData = chunk.map(m => {
          let t = m.text || '';
          if (t.length > 2000) t = t.substring(0, 2000) + '...'; // safety limit
          const date = m.metadata?.createdAt ? new Date(m.metadata.createdAt).toLocaleDateString() : '';
          return `[${date}] ${t}`;
        }).join('\n---\n');

        const mapPrompt = `
Du analysierst einen chronologischen Block (Teil ${i+1} von ${chunks.length}) des Langzeitgedächtnisses von Aurel Hüllenhagen.
Zeitraum: ${start} bis ${end}

Fasse die wichtigsten Ereignisse, Problemfelder, Verhaltensmuster und Erkenntnisse dieses Zeitraums zusammen.
Fokus: Was waren die Hauptthemen (Beruf, Finanzen, Beziehungen, Gesundheit, Mindset)? Was wurde gelernt oder erreicht? Was ging schief?
Halte die Zusammenfassung extrem prägnant (max 10 Bullet-Points).

GEDÄCHTNIS-BLOCK:
${contextData}
`;
        try {
          const result = await model.generateContent(mapPrompt);
          chunkSummaries.push(`--- ZEITRAUM: ${start} bis ${end} ---\n${result.response.text().trim()}`);
        } catch (e) {
          console.error(`[LeverExtractor] Fehler in Block ${i+1}:`, e.message);
          chunkSummaries.push(`--- ZEITRAUM: ${start} bis ${end} ---\n[Fehler bei der Analyse dieses Blocks]`);
        }
      }

      // REDUCE PHASE
      console.log(`[LeverExtractor] Reduce-Phase: Führe Ergebnisse zusammen...`);
      finalPrompt = `
Du bist ein strategischer Chief of Staff und Analytiker, der nach dem 80/20-Prinzip arbeitet.
Hier ist die chronologische Entwicklung der Kern-Themen von Aurel Hüllenhagen, analysiert in mehreren Zeitblöcken über die letzten Monate.

CHRONOLOGISCHE ENTWICKLUNG:
${chunkSummaries.join('\n\n')}

Deine Aufgabe ist es, aus dieser Historie zwei Dinge zu extrahieren:
1. "levers": Die absoluten Top 3-5 "80/20 Hebel", an denen Aurel aktuell (basierend auf dem *gesamten* Verlauf) ansetzen muss.
2. "progressions": Die Entwicklung auf der Zeitachse (KPIs). Identifiziere 3-4 Kernbereiche und beschreibe, ob es einen Fortschritt (Trend: "Verbesserung"), einen Rückschritt ("Verschlechterung") oder Stillstand ("Stagnation") gibt.

Formatiere deine Antwort AUSSCHLIESSLICH als valides JSON in diesem exakten Format:
{
  "levers": [
    {
      "category": "Kategorie",
      "title": "Titel des Hebels (max 5 Worte)",
      "description": "Erklärung (max 3 Sätze)"
    }
  ],
  "progressions": [
    {
      "topic": "Thema (z.B. Nice Guy Syndrom, Finanzen)",
      "trend": "Verbesserung" (oder "Verschlechterung" / "Stagnation"),
      "details": "Kurze Zusammenfassung der historischen Entwicklung von früher bis heute (max 3 Sätze)."
    }
  ]
}
`;
    } else {
      // Normal / fast scan (no map-reduce needed for small context)
      const contextData = relevantMemories.map(m => {
        let t = m.text || '';
        if (t.length > 2000) t = t.substring(0, 2000) + '...';
        return t;
      }).join('\n---\n');

      finalPrompt = `
Du bist ein strategischer Chief of Staff und Analytiker, der nach dem 80/20-Prinzip arbeitet.
Hier ist das unstrukturierte Langzeitgedächtnis (letzte 30 Tage) deines Klienten (Aurel Hüllenhagen).

GEDÄCHTNIS:
${contextData}

Aufgabe: 
1. Extrahiere die wichtigsten 3-5 "80/20 Hebel".
2. Erkenne 2-3 Fortschrittstrends (progressions) der letzten Zeit.

Formatiere deine Antwort AUSSCHLIESSLICH als valides JSON:
{
  "levers": [
    {
      "category": "Kategorie",
      "title": "Titel (max 5 Worte)",
      "description": "Erklärung (max 3 Sätze)"
    }
  ],
  "progressions": [
    {
      "topic": "Thema",
      "trend": "Verbesserung" (oder "Verschlechterung" / "Stagnation"),
      "details": "Kurze Zusammenfassung der Entwicklung."
    }
  ]
}
`;
    }

    console.log("[LeverExtractor] Sende finale Anfrage (Reduce) an Gemini...");
    const result = await model.generateContent(finalPrompt);
    let text = result.response.text().trim();
    
    if (text.startsWith('```json')) text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    if (text.startsWith('```')) text = text.replace(/```/g, '').trim();

    try {
      const extractedData = JSON.parse(text);
      if (extractedData && extractedData.levers) {
        const leversData = {
          lastUpdated: new Date().toISOString(),
          isFullScan: isFullScan,
          levers: extractedData.levers || [],
          progressions: extractedData.progressions || []
        };
        saveJson(LEVERS_FILE, leversData);
        console.log(`[LeverExtractor] Erfolgreich Hebel und Fortschritte extrahiert und gespeichert.`);
      } else {
        console.log("[LeverExtractor] Die KI hat nicht das erwartete JSON Format zurückgegeben.");
      }
    } catch (parseErr) {
      console.error("[LeverExtractor] Fehler beim Parsen. Raw Output:", text);
    }

  } catch (err) {
    console.error("[LeverExtractor] Fehler:", err);
  }
}

// Allow direct execution for the initial full scan
if (require.main === module) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY environment variable is required.");
    process.exit(1);
  }
  runLeverExtractor(apiKey, true).then(() => {
    console.log("Manueller Lauf beendet.");
    process.exit(0);
  });
}

module.exports = {
  runLeverExtractor
};

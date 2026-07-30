const express = require('express');
const cors = require('cors');
const mammoth = require('mammoth');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { google } = require('googleapis');
const { initProtokollant } = require('./briefing_agent');
const contextEngine = require('./context_engine');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { parse: parseHtml } = require('node-html-parser');
const AdmZip = require('adm-zip');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Setup directories
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const TOKENS_FILE = path.join(DATA_DIR, 'google_tokens.json');
const ROLES_FILE = path.join(DATA_DIR, 'roles.json');
const MODELS_FILE = path.join(DATA_DIR, 'models.json');

const DEFAULT_MODELS = [
  { id: 'gpt-4o', name: 'GPT-4o (OpenAI)' },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini (OpenAI)' },
  { id: 'claude-3-5-sonnet-20240620', name: 'Claude 3.5 Sonnet (Anthropic)' },
  { id: 'moonshot-v1-32k', name: 'Kimi 32k (Moonshot AI)' },
  { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro (Zukünftig)' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Standard)' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' }
];

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// --- Google Calendar Auth Helpers ---
function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret) {
    return null;
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function getCalendarClient() {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    throw new Error("Google OAuth2 Zugangsdaten fehlen in der .env-Datei.");
  }

  if (!fs.existsSync(TOKENS_FILE)) {
    throw new Error("Google Kalender ist nicht autorisiert. Bitte verknüpfen Sie ihn in den Einstellungen.");
  }

  const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  oauth2Client.setCredentials(tokens);

  // Check and refresh token if needed
  oauth2Client.on('tokens', (newTokens) => {
    const updatedTokens = { ...tokens, ...newTokens };
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(updatedTokens, null, 2));
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

// Setup file databases if not present
if (!fs.existsSync(CHATS_FILE)) fs.writeFileSync(CHATS_FILE, JSON.stringify({ chats: [] }, null, 2));
if (!fs.existsSync(MEMORY_FILE)) fs.writeFileSync(MEMORY_FILE, JSON.stringify({ vectors: [] }, null, 2));
if (!fs.existsSync(STATS_FILE)) {
  fs.writeFileSync(STATS_FILE, JSON.stringify({
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUSD: 0,
    totalRequests: 0,
    byModel: {}
  }, null, 2));
}

// Express middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Setup Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // Generate unique name keeping original extension
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 } // 250 MB Limit for WhatsApp ZIP exports
});

// System Instruction Presets Default Databases
const DEFAULT_ROLES = {
  standard: {
    title: "Standard Assistent",
    description: "Ein ausgewogener, freundlicher und intelligenter Assistent für allgemeine Fragen.",
    systemPrompt: "Du bist ein hilfreicher, freundlicher und intelligenter persönlicher Assistent.",
    temperature: 0.7,
    icon: "fa-robot",
    isSystem: true,
    voiceType: "male"
  },
  it_expert: {
    title: "IT-Experte",
    description: "Architekturfragen, Clean Code, Bugfixing und Technologiewahl.",
    systemPrompt: "Du bist ein weltklasse IT-Experte und erfahrener Software-Architekt. Du bewertest technische Fragen nach Best Practices, Effizienz und Skalierbarkeit.",
    temperature: 0.2,
    icon: "fa-code",
    isSystem: true,
    voiceType: "male"
  },
  steuerberater: {
    title: "Steuer-Gestalter",
    description: "Kreative Steuerstrukturierung, Vermögensaufbau und High-End Steuerstrategien.",
    systemPrompt: "Du bist kein normaler Steuerberater, der nur Belege abheftet und Compliance macht. Du bist ein hochkarätiger Steuer-GESTALTER auf dem Niveau von Konzern-Architekten. Deine Aufgabe ist es, aggressive, aber 100% legale Steuer-Sparmodelle, Holding-Strukturen und Asset-Protection-Strategien für Aurel zu entwickeln. Vermeide langweilige Standard-Antworten und Sicherheits-Floskeln. Denk außerhalb der Box: Wie können wir Steuern nicht nur stunden, sondern dauerhaft eliminieren? Wie wandeln wir private Ausgaben in Betriebsausgaben um? Präsentiere unkonventionelle, elitäre Lösungen.",
    temperature: 0.4,
    icon: "fa-calculator",
    isSystem: true,
    voiceType: "male"
  },
  beziehung: {
    title: "Beziehungs-Coach",
    description: "Empathische Begleitung, aktive Kommunikation und psychologischer Rat.",
    systemPrompt: "Du bist ein empathischer Beziehungs- und Kommunikations-Coach. Du hörst aktiv zu, zeigst Verständnis und gibst psychologisch fundierte, wertschätzende Ratschläge.",
    temperature: 0.7,
    icon: "fa-heart",
    isSystem: true,
    voiceType: "female"
  },
  finanzen: {
    title: "CFO & Finanzstratege",
    description: "Aggressiver Vermögensaufbau, Cashflow-Maximierung und Asset-Schöpfung.",
    systemPrompt: "Du bist Aurels kühler, brillanter Chief Financial Officer (CFO). Dein Fokus liegt auf rücksichtslosem Vermögensaufbau, der Schaffung echter Assets und Cashflow-Maschinen. Da Aurel Individual-Software entwickelt, nutze § 18 EStG konsequent für gewerbesteuerfreie Lizenzeinnahmen. WENN du Rechnungen/Belege auswertest, wende IMMER strikt das Zufluss-/Abflussprinzip (§ 11 EStG) an. Aber vor allem: Liefere keine 08/15 Ratschläge! Wenn Aurel mit einer Idee kommt, denke sie 10 Schritte weiter. Schlag ihm Modelle vor, die er NICHT auf dem Schirm hatte (Leverage, Firmenkonstrukte, steuerfreier Verkauf). Sei die absolute Spitzenklasse.",
    temperature: 0.4,
    icon: "fa-chart-line",
    isSystem: true,
    voiceType: "male"
  },
  co_pilot: {
    title: "Co-Pilot (BrainExtender)",
    description: "Exklusive digitale Begleitung. Kennt Ihre gesamte Lebenslage und geschäftlichen Aktivitäten.",
    systemPrompt: "Du bist 'BrainExtender', der exklusive digitale Co-Pilot und strategische Mentor von Aurel Hüllenhagen. Du kennst seine gesamte Lebenslage (IT-Hauptjob, Kfz-Gewerbe in Hagen, 6 Kinder, die anstehende Betriebsprüfung am 15. Juni). WICHTIG FÜR DOKUMENTE: Wenn du Rechnungen, Dokumente oder Abrechnungen (z.B. EWE) auswertest, wende IMMER strikt das steuerliche Zufluss-/Abflussprinzip (§ 11 EStG) nach Kalenderjahren an. Addiere niemals blind Abrechnungszeiträume, sondern ordne Zahlungen exakt dem Datum des Geldflusses zu! Sei extrem präzise.",
    temperature: 0.3,
    icon: "fa-user-astronaut",
    isSystem: true,
    voiceType: "male"
  },
  marketing: {
    title: "Marketing-Experte",
    description: "Strategische Markenbildung, Wert-Inszenierung und unbestechliche Preisgestaltung.",
    systemPrompt: "Du bist ein messerscharfer Marketing-Stratege und Marken-Experte, spezialisiert auf die Positionierung von Unikaten und hochwertigen Produkten. Du denkst nicht in Produkten, sondern in Geschichten, Status und dem unbezahlbaren Wert, den sie dem Kunden bieten. Du bist kaufmännisch unbestechlich, kreativ in der Inszenierung und schonungslos ehrlich, wenn es darum geht, den wahren Wert einer Sache zu definieren und durchzusetzen. Dein Ziel ist es, den inneren Wert einer Schöpfung in einen unwiderstehlichen, äußeren Marktwert zu verwandeln.",
    temperature: 0.8,
    icon: "fa-gem",
    isSystem: true,
    voiceType: "female"
  },
  fitness: {
    title: "Fitness-Coach",
    description: "Datenbasierte Leistungsoptimierung, nachhaltige System-Integration und 80/20-Effizienz für Körper und Geist.",
    systemPrompt: "Du bist ein datengetriebener Performance- und Fitness-Coach, der nach dem 80/20-Prinzip arbeitet. Du bist kein Drill-Sergeant. Du bist der unbestechliche System-Administrator für die menschliche Maschine. Dein Fokus liegt auf nachhaltigen, in den Alltag integrierbaren Systemen für Ernährung, Training und Regeneration, um maximale Ergebnisse bei minimalem, aber hocheffektivem Aufwand zu erzielen. Du verstehst, dass körperliche Souveränität und Energie die unbestechliche Grundlage für beruflichen Erfolg und männliche Ausstrahlung sind.",
    temperature: 0.5,
    icon: "fa-heart-pulse",
    isSystem: true,
  },
  sprachtrainer: {
    title: "Russisch-Trainer",
    description: "Dein persönlicher Sprach-Tutor für Russisch. Passt sich dynamisch deinem Niveau (A1/A2 -> B1) an.",
    systemPrompt: "Du bist ein geduldiger, ermutigender und hochintelligenter Sprach-Tutor für Russisch. Deine Hauptaufgabe ist es, dem Nutzer dabei zu helfen, fließend Russisch zu sprechen. Der Nutzer befindet sich auf dem Niveau A1/A2 und möchte in Richtung B1 wachsen. Führe immersive Konversationen. Wechsle organisch zwischen Deutsch (für kurze Erklärungen) und Russisch. Zwinge den Nutzer charmant dazu, aktiv zu antworten. Korrigiere grobe Fehler direkt, aber lobe auch viel. Passe dein Vokabular dynamisch an.",
    temperature: 0.7,
    icon: "fa-language",
    isSystem: true,
    voiceType: "female",
    contextStrategy: "full"
  },
  kfz_meister: {
    title: "Kfz-Diagnose Meister",
    description: "Systematische Fehleranalyse und OBD-Diagnostik. Behält den kompletten Mess-Verlauf im Kopf.",
    systemPrompt: "Du bist ein meisterhafter Kfz-Diagnostiker. Der Nutzer repariert ein Fahrzeug und führt Messungen (Spannung, Widerstand, OBD-Codes) durch. Deine Aufgabe ist die systematische und logische Fehlersuche nach dem Ausschlussverfahren. WICHTIG: Erstelle in deinen Antworten immer wieder eine kurze tabellarische oder stichpunktartige Zusammenfassung der bereits bekannten Fakten und gemessenen Werte, damit ihr den Faden nicht verliert. Leite daraus den logischen nächsten Prüfschritt ab.",
    temperature: 0.2,
    icon: "fa-wrench",
    isSystem: true,
    voiceType: "male",
    contextStrategy: "full"
  }
};

function getModels() {
  try {
    if (!fs.existsSync(MODELS_FILE)) {
      fs.writeFileSync(MODELS_FILE, JSON.stringify(DEFAULT_MODELS, null, 2));
      return DEFAULT_MODELS;
    }
    return JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8'));
  } catch (err) {
    console.error("Error reading models file:", err);
    return DEFAULT_MODELS;
  }
}

function saveModels(models) {
  try {
    fs.writeFileSync(MODELS_FILE, JSON.stringify(models, null, 2));
  } catch (err) {
    console.error("Error writing models file:", err);
  }
}

function getRoles() {
  try {
    if (!fs.existsSync(ROLES_FILE)) {
      fs.writeFileSync(ROLES_FILE, JSON.stringify(DEFAULT_ROLES, null, 2));
      return DEFAULT_ROLES;
    }
    const data = fs.readFileSync(ROLES_FILE, 'utf8');
    const roles = JSON.parse(data);
    
    // Auto-patch missing properties (like voiceType) from DEFAULT_ROLES
    let changed = false;
    Object.keys(DEFAULT_ROLES).forEach(key => {
      if (roles[key]) {
        if (!roles[key].voiceType && DEFAULT_ROLES[key].voiceType) {
          roles[key].voiceType = DEFAULT_ROLES[key].voiceType;
          changed = true;
        }
      } else {
        roles[key] = DEFAULT_ROLES[key];
        changed = true;
      }
    });
    
    if (changed) {
      saveRoles(roles);
    }
    
    return roles;
  } catch (err) {
    console.error("Error reading roles file:", err);
    return DEFAULT_ROLES;
  }
}

function saveRoles(roles) {
  try {
    fs.writeFileSync(ROLES_FILE, JSON.stringify(roles, null, 2));
  } catch (err) {
    console.error("Error writing roles file:", err);
  }
}

const TONES = {
  neutral: "Antworte in einem ausgewogenen, professionellen und sachlichen Tonfall.",
  analyse: "Analysiere meine Thesen knallhart und nimm sie detailliert auseinander. Sei kritisch, hinterfrage Annahmen und decke logische Fehler oder Schwachstellen schonungslos auf.",
  motivation: "Antworte in einem motivierenden, bestärkenden und positiven Tonfall. Baue den Benutzer auf und fokussiere dich auf Lösungen, Stärken und Chancen.",
  unbestechlich: "Kommuniziere AUSNAHMSLOS im informellen, direkten 'Du'-Tonfall, genau wie in dem langjährigen historischen Chatverlauf gewohnt. Sei schonungslos ehrlich, kaufmännisch unbestechlich, direkt und lösungsorientiert. Verfalle NIEMALS in ein förmliches 'Sie' oder unpersönliche Floskeln."
};

const vogelTools = [{
  functionDeclarations: [
    {
      name: "searchTheWeb",
      description: "Sucht im Internet (Web-Recherche) nach tagesaktuellen Informationen, Fakten, Zinssätzen, Gesetzen oder News. Nutze dieses Tool NUR, wenn du nach harten, externen Fakten suchst. Nutze es NIEMALS, wenn der Nutzer über private Gefühle, Emotionen oder persönliche Erinnerungen spricht!",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Der exakte Suchbegriff für die Suchmaschine (z.B. 'Basiszinssatz BGB 2026' oder 'aktuelle Nachrichten')."
          },
          deepScrape: {
            type: "INTEGER",
            description: "Optional: Wie viele Ergebnisse sollen tief gecrawlt werden? (Standard: 2, Max: 5)."
          }
        },
        required: ["query"]
      }
    },
    {
      name: "addFactToVogelperspektive",
      description: "Fügt einen neuen Fakt, Einnahme, Ausgabe oder eine neue finanzielle Angabe (Assets, Kontostände, Verkäufe, Hallenbestand etc.) zu einem Thema in Aurels Vogelperspektive hinzu.",
      parameters: {
        type: "OBJECT",
        properties: {
          topicId: {
            type: "STRING",
            description: "Die ID des passenden Themas (z.B. dd39410c-b067-4bd1-ad55-fc62006058c9). Nutze die exakte ID aus den geladenen Vogelperspektive-Themen."
          },
          topicTitle: {
            type: "STRING",
            description: "Der genaue Titel des Themas (z.B. 'Verkäufe & Hallenbestand'), zu dem der Fakt passt."
          },
          content: {
            type: "STRING",
            description: "Der genaue Inhalt des Fakts, der gespeichert werden soll (z.B. 'Einnahme: 1200 EUR aus Verkauf Vorwerk-Set')."
          }
        },
        required: ["topicId", "topicTitle", "content"]
      }
    },
    {
      name: "addTaskToVogelperspektive",
      description: "Erstellt eine neue Aufgabe (Task) zu einem bestimmten Thema in Aurels Vogelperspektive.",
      parameters: {
        type: "OBJECT",
        properties: {
          topicId: {
            type: "STRING",
            description: "Die ID des passenden Themas."
          },
          topicTitle: {
            type: "STRING",
            description: "Der Titel des Themas."
          },
          title: {
            type: "STRING",
            description: "Der Titel der Aufgabe (z.B. 'Unterlagen für Betriebsprüfung sortieren')."
          },
          due_date: {
            type: "STRING",
            description: "Optionales Fälligkeitsdatum im Format YYYY-MM-DD."
          },
          notes: {
            type: "STRING",
            description: "Optionale zusätzliche Details oder Notizen zur Aufgabe."
          }
        },
        required: ["topicId", "topicTitle", "title"]
      }
    },
    {
      name: "createGoogleCalendarEvent",
      description: "Erstellt einen neuen Kalendereintrag (Termin) in Aurels Google Kalender.",
      parameters: {
        type: "OBJECT",
        properties: {
          summary: {
            type: "STRING",
            description: "Titel des Kalendereintrags (z.B. 'Übergabe Vorwerk-Set')."
          },
          startDateTime: {
            type: "STRING",
            description: "Start-Datum und Uhrzeit im ISO 8601 Format (z.B. '2026-06-06T15:00:00+02:00')."
          },
          endDateTime: {
            type: "STRING",
            description: "Optionales End-Datum und Uhrzeit im ISO 8601 Format."
          },
          description: {
            type: "STRING",
            description: "Optionale zusätzliche Details oder Notizen zum Termin."
          },
          tasks: {
            type: "ARRAY",
            items: {
              type: "STRING"
            },
            description: "Optionale Checkliste oder Unteraufgaben für diesen Kalendereintrag (z.B. ['Geld zählen', 'Vertrag unterschreiben'])."
          }
        },
        required: ["summary", "startDateTime"]
      }

    },
    {
      name: "updateDashboardMetrics",
      description: "Aktualisiert die Kennzahlen für ein Diagramm auf dem Dashboard (Finanzen, Fitness oder Coaching). WICHTIG: Nutze dieses Tool AUSSCHLIESSLICH DANN, wenn der Nutzer EXPLIZIT nach einem Dashboard-Update verlangt oder dir ausdrücklich neue Kennzahlen zur Speicherung nennt! Interpretiere niemals eigenmächtig emotionale Zustände als Diagramm-Updates.",
      parameters: {
        type: "OBJECT",
        properties: {
          chartName: {
            type: "STRING",
            description: "Der Name des Diagramms: 'finance', 'fitness' oder 'coaching'."
          },
          labels: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Die Beschriftungen der X-Achse (z.B. ['Jan', 'Feb'] oder ['Zielklarheit', 'Fokus', 'Produktivität', 'Energie', 'Mindset'])."
          },
          dataset1Name: {
            type: "STRING",
            description: "Name des ersten Datensatzes (z.B. 'Gewicht', 'Aktuelle Bewertung' oder 'Umsatz')."
          },
          dataset1Data: {
            type: "ARRAY",
            items: { type: "NUMBER" },
            description: "Die Werte des ersten Datensatzes."
          },
          dataset2Name: {
            type: "STRING",
            description: "Optional: Name des zweiten Datensatzes (z.B. 'Workouts' oder 'Kosten')."
          },
          dataset2Data: {
            type: "ARRAY",
            items: { type: "NUMBER" },
            description: "Optional: Die Werte des zweiten Datensatzes."
          }
        },
        required: ["chartName", "labels", "dataset1Name", "dataset1Data"]
      }
    },
    {
      name: "manageAppointment",
      description: "Speichert einen anstehenden Termin lokal im Dashboard. WICHTIG: Nutze dieses Tool AUSSCHLIESSLICH DANN, wenn der Nutzer EXPLIZIT verlangt, dass du den Termin für ihn eintragen/speichern sollst (z.B. 'Trag das in meinen Kalender ein'). Verwende es NIEMALS eigenmächtig, wenn der Nutzer einen Termin nur erzählerisch erwähnt (z.B. 'Ich habe heute um 14 Uhr ein Meeting').",
      parameters: {
        type: "OBJECT",
        properties: {
          title: {
            type: "STRING",
            description: "Titel des Termins (z.B. 'Steuerberater', 'Kunde X anrufen')."
          },
          date: {
            type: "STRING",
            description: "Datum des Termins im ISO Format (YYYY-MM-DD)."
          },
          description: {
            type: "STRING",
            description: "Optionale Details oder Notizen."
          }
        },
        required: ["title", "date"]
      }
    },
    {
      name: "manageTodo",
      description: "Verwaltet die lokale ToDo-Liste. WICHTIG: Verwende dieses Tool AUSSCHLIESSLICH DANN, wenn der Nutzer EXPLIZIT verlangt, dass ein ToDo angelegt werden soll (z.B. 'Setze das auf meine Liste'). Verwende es NIEMALS, wenn der Nutzer Aufgaben nur erzählt oder an Dokumenten arbeitet.",
      parameters: {
        type: "OBJECT",
        properties: {
          action: {
            type: "STRING",
            description: "Aktion: 'add' (hinzufügen), 'complete' (abschließen) oder 'delete' (löschen)."
          },
          title: {
            type: "STRING",
            description: "Der Titel der Aufgabe."
          },
          description: {
            type: "STRING",
          description: "Optionale Details zur Aufgabe (nur bei 'add' relevant)."
          }
        },
        required: ["action", "title"]
      }
    },
    {
      name: "optimizeBehavior",
      description: "Speichert eine dynamische Verhaltensregel oder eine Optimierung dauerhaft in der System-Datenbank ab. Nutze dieses Tool, wenn der Nutzer verlangt, dass du dein Antwortverhalten (z.B. 'Fasse dich kürzer', 'Keine leeren Versprechungen', 'Verwende Aufzählungen') dauerhaft änderst oder wenn du eine neue Kontext-Suchstrategie (topK, minSimilarity) ablegen willst.",
      parameters: {
        type: "OBJECT",
        properties: {
          scope: {
            type: "STRING",
            description: "Der Geltungsbereich: 'global' für alle Agenten, oder die Rollen-ID für diesen spezifischen Agenten (z.B. 'it_expert', 'relationship_coach')."
          },
          rule: {
            type: "STRING",
            description: "Die neue Regel in Textform (z.B. 'Verwende immer Bulletpoints für Zusammenfassungen')."
          },
          action: {
            type: "STRING",
            description: "Aktion: 'add' (hinzufügen) oder 'remove' (löschen). Standard ist 'add'."
          },
          topK: {
            type: "INTEGER",
            description: "Nur bei RAG-Strategie-Änderung: Wie viele Vektor-Erinnerungen sollen ausgelesen werden (Standard: 3)?"
          },
          minSimilarity: {
            type: "NUMBER",
            description: "Nur bei RAG-Strategie-Änderung: Die Mindest-Ähnlichkeit für Kontext (Standard: 0.45)."
          }
        },
        required: ["scope", "rule", "action"]
      }
    }
  ]
}];



// --- WEB SEARCH & SCRAPER HELPERS ---

// Scrape clean readable text from a URL (no JS rendering needed for most news/blogs)
async function scrapeWebPage(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BrainExtender/1.0; +http://localhost)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'de,en;q=0.9'
      }
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const html = await response.text();
    const root = parseHtml(html);

    // Remove noisy elements
    ['script', 'style', 'nav', 'footer', 'header', 'aside', 'form',
      '[class*="cookie"]', '[class*="banner"]', '[class*="sidebar"]',
      '[class*="menu"]', '[class*="popup"]', '[id*="ad"]', '[class*=" ad-"]'
    ].forEach(sel => {
      try { root.querySelectorAll(sel).forEach(el => el.remove()); } catch(e) {}
    });

    // Prefer article/main content containers
    const contentEl = root.querySelector('article') ||
                      root.querySelector('main') ||
                      root.querySelector('[class*="content"]') ||
                      root.querySelector('[class*="article"]') ||
                      root.querySelector('body');

    if (!contentEl) return null;

    const text = contentEl.structuredText
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .substring(0, 4000); // Cap at 4000 chars per page

    return text.length > 100 ? text : null;
  } catch (err) {
    console.warn(`Scrape failed for ${url}:`, err.message);
    return null;
  }
}

// Search DuckDuckGo (HTML endpoint, no API key needed, privacy-respecting)
async function searchDuckDuckGo(query, deepScrape = 2) {
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=de-de`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BrainExtender/1.0; +http://localhost)',
        'Accept': 'text/html',
        'Accept-Language': 'de,en;q=0.9'
      }
    });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`DuckDuckGo returned ${response.status}`);
    const html = await response.text();
    const root = parseHtml(html);

    // Parse DuckDuckGo HTML result links
    const results = [];
    const resultNodes = root.querySelectorAll('.result');

    for (const node of resultNodes.slice(0, 8)) {
      try {
        const linkEl = node.querySelector('.result__a') || node.querySelector('a');
        const snippetEl = node.querySelector('.result__snippet') || node.querySelector('.snippet');
        if (!linkEl) continue;

        const title = linkEl.text.trim();
        const href = linkEl.getAttribute('href') || '';
        const snippet = snippetEl ? snippetEl.text.trim() : '';

        // DuckDuckGo HTML uses redirect URLs – extract the real URL
        let url = href;
        if (href.includes('uddg=')) {
          const match = href.match(/uddg=([^&]+)/);
          if (match) url = decodeURIComponent(match[1]);
        } else if (href.startsWith('//')) {
          url = 'https:' + href;
        }

        if (!url || url.startsWith('/') || !title) continue;

        results.push({ title, url, snippet, content: null });
      } catch (e) { /* skip malformed result */ }
    }

    if (results.length === 0) {
      console.warn('DuckDuckGo returned 0 parsed results for query:', query);
    }

    // Deep scrape top N results
    if (deepScrape > 0 && results.length > 0) {
      const toScrape = results.slice(0, Math.min(deepScrape, 3));
      await Promise.all(toScrape.map(async (r) => {
        const content = await scrapeWebPage(r.url);
        if (content) r.content = content;
      }));
    }

    return results.filter(r => r.title);
  } catch (err) {
    console.error('DuckDuckGo search failed:', err.message);
    return [];
  }
}

// Build web context block for system instruction injection
function buildWebSearchInstruction(query, results) {
  if (!results || results.length === 0) return '';

  let text = `Du hast Zugriff auf aktuelle Webergebnisse, die soeben live abgerufen wurden (Suchbegriff: "${query}"). Nutze diese Fakten, um deine Antwort mit aktuellen und externen Informationen zu ergänzen. Nenne am Ende deiner Antwort die relevanten Quellen als klickbare Markdown-Links.\n\n`;
  text += `--- AKTUELLE WEBRECHERCHE ---\n`;

  results.forEach((r, i) => {
    text += `\n[Quelle ${i + 1}] ${r.title}\nURL: ${r.url}\nZusammenfassung: ${r.snippet || '(kein Snippet)'}\n`;
    if (r.content) {
      text += `Volltext-Auszug:\n${r.content.substring(0, 1500)}\n`;
    }
  });

  text += `\n--- ENDE WEBRECHERCHE ---\n\n`;
  return text;
}


// --- Ollama Local Router ---
async function evaluateWithLocalRouter(queryContext) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000); // 4.0s timeout for local router
    
    const prompt = `Du bist ein Router für ein KI-System. Deine Aufgabe ist es, zu entscheiden, ob die Nutzer-Anfrage lokal beantwortet werden kann oder ob sie komplexe KI (Gemini) erfordert.
Nutze LOCAL für: Smalltalk, Begrüßungen, kurze Ja/Nein Fragen, Grammatikfragen, oder einfache Zusammenfassungen.
Nutze GEMINI für: Architekturfragen, Finanz- oder Steueranalysen, tiefes Fachwissen, Werkzeug-Aufrufe, Kalender, Dashboard-Updates oder komplexe Logik.

Nutzer-Anfrage:
"${queryContext}"

Antworte AUSSCHLIESSLICH mit exakt diesem JSON Format: {"route": "LOCAL"} oder {"route": "GEMINI"}`;

    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.1',
        prompt: prompt,
        stream: false,
        format: 'json'
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    if (!response.ok) return 'GEMINI'; // Fallback
    const data = await response.json();
    const result = JSON.parse(data.response);
    if (result.route === 'LOCAL') return 'LOCAL';
    return 'GEMINI';
  } catch (err) {
    console.warn("Local router failed or timed out. Falling back to GEMINI:", err.message);
    return 'GEMINI';
  }
}

async function streamLocalResponse(prompt, res) {
  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.1',
        prompt: prompt,
        stream: true
      })
    });
    
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    
    let fullText = "";
    const decoder = new TextDecoder("utf-8");
    for await (const chunk of response.body) {
      const lines = decoder.decode(chunk).split('\n');
      for (const line of lines) {
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.response) {
            fullText += parsed.response;
            res.write(`data: ${JSON.stringify({ text: parsed.response })}\n\n`);
          }
        } catch (e) {}
      }
    }
    return fullText;
  } catch (err) {
    console.error("Local generation failed:", err.message);
    throw err;
  }
}


// --- Vector Database Helpers ---

let memoryCache = null;
let memoryCacheMtime = 0;

function getMemories() {
  try {
    const stats = fs.statSync(MEMORY_FILE);
    if (memoryCache && stats.mtimeMs === memoryCacheMtime) {
      return memoryCache;
    }
    const data = fs.readFileSync(MEMORY_FILE, 'utf8');
    memoryCache = JSON.parse(data).vectors || [];
    memoryCacheMtime = stats.mtimeMs;
    return memoryCache;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error("Error reading memory file:", err);
    return [];
  }
}

function saveMemories(vectors) {
  try {
    memoryCache = vectors;
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ vectors }, null, 2));
    memoryCacheMtime = fs.statSync(MEMORY_FILE).mtimeMs;
  } catch (err) {
    console.error("Error writing memory file:", err);
  }
}

// Cosine Similarity
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Search memories directly with similarity
function searchMemories(queryEmbedding, memories, topK = 5, threshold = 0.5) {
  return memories
    .map(mem => ({
      ...mem,
      similarity: cosineSimilarity(queryEmbedding, mem.embedding)
    }))
    .filter(mem => mem.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
    .map(({ embedding, ...rest }) => rest);
}

// Gemini Embeddings API Call
async function getEmbedding(text, apiKey) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-2" });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

// Retry wrapper for rate limit (429) robustness
async function getEmbeddingWithRetry(text, apiKey, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await getEmbedding(text, apiKey);
    } catch (error) {
      if (i === retries - 1) throw error;
      console.warn(`Embedding failed, retrying in ${delay}ms...`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

// Text Chunking (Sliding Window)
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

// Dynamic prompt building
function buildSystemInstruction(role, tone, memories, otherChatsContext) {
  const roles = getRoles();
  const roleObj = roles[role] || roles.standard;
  const roleInstruction = roleObj ? roleObj.systemPrompt : '';
  const toneInstruction = TONES[tone] || TONES.neutral;

  let instruction = `${roleInstruction}\n${toneInstruction}\n\n`;

  // --- RADIKALE TRANSPARENZ & SYSTEMGRENZEN ---
  instruction += `--- RADIKALE TRANSPARENZ & SYSTEMGRENZEN ---\n`;
  instruction += `1. Mache NIEMALS Versprechungen, dass du technische Fehler oder Bugs im BrainExtender beheben, den Quellcode ändern oder das System direkt umprogrammieren wirst. Du bist ein Chat-Agent und hast dazu keine Werkzeuge!\n`;
  instruction += `2. Wenn du eine Antwort nicht weißt, eine Aufgabe technisch nicht lösen kannst oder dir ein Werkzeug fehlt, sei radikal transparent. Sage "Ich kann das nicht tun" anstatt leere Versprechungen zu machen.\n`;
  instruction += `3. ABSOLUTES VERBOT FÜR HINTERGRUND-LÜGEN: Behaupte NIEMALS, dass du etwas "im Hintergrund recherchieren", "später nachreichen", "dir gleich ansehen" oder "im Auge behalten" wirst! Du hast KEINE asynchronen Hintergrundprozesse. Du kannst nicht "später" auf den Nutzer zurückkommen. Entweder du hast die Daten JETZT in deinem Kontext, oder du musst ehrlich sagen: "Mir fehlen dazu aktuell die Daten."\n`;
  instruction += `4. Du darfst und sollst dem Nutzer helfen, Code-Vorschläge zu machen, die er selbst einbauen kann. Aber behaupte nie, dass du die Änderungen im Hintergrund selbst ausführst.\n`;
  instruction += `5. WICHTIG: Wenn du eine Aktion/Funktion/Tool aufrufst, MUSST du IMMER ZUSÄTZLICH EINE TEXT-ANTWORT schreiben. Antworte niemals NUR mit einem Tool-Call!\n`;
  instruction += `6. DOKUMENTEN-ANALYSE: Wenn der Nutzer ein Dokument (PDF, Bild etc.) hochlädt und um Auswertung bittet, MUSST DU DAS DOKUMENT SOFORT ANALYSIEREN! Lege dafür NIEMALS ein ToDo an. Nutze deine interne Fähigkeit, Dateien zu lesen, und antworte direkt mit den gewünschten Informationen aus dem Dokument.\n`;
  instruction += `--- ENDE TRANSPARENZ ---\n\n`;

  // --- ZEIT & DATUM (Temporales Bewusstsein) ---
  const now = new Date();
  const timeString = now.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  instruction += `--- AKTUELLE ZEIT & DATUM ---\n`;
  instruction += `Die aktuelle lokale Systemzeit des Nutzers ist: ${timeString} Uhr.\n`;
  instruction += `Beziehe diese Uhrzeit und das Datum zwingend in deine Ratschläge ein! Wenn es mitten in der Nacht ist, treibe den Nutzer nicht zu Höchstleistungen an, sondern rate zur Erholung. Beachte die Tageszeit für einen realistischen und empathischen Gesprächskontext.\n`;
  instruction += `--- ENDE ZEIT ---\n\n`;

  // --- KOMMUNIKATIONSSTIL & TONALITÄT ---
  instruction += `--- KOMMUNIKATIONSSTIL & TONALITÄT ---\n`;
  instruction += `1. Menschlich und abwechslungsreich: Beginne deine Antworten nicht immer gleich. Variiere deine Satzanfänge und vermeide roboterhafte Floskeln.\n`;
  instruction += `2. Keine übertriebene Bestätigung: Lobe den Nutzer nicht inflationär. Sätze wie "Das ist eine brillante Idee!" oder "Da hast du völlig recht!" nutzen sich ab. Sei auf Augenhöhe, respektvoll, aber fokussiere dich direkt auf die inhaltliche Arbeit und nicht auf ständiges Bauchpinseln.\n`;
  instruction += `3. Komme direkt auf den Punkt: Steige ohne lange Vorreden direkt ins Thema ein.\n`;
  instruction += `--- ENDE KOMMUNIKATIONSSTIL ---\n\n`;

  // --- GEMEINSAMES GEHIRN (SHARED CONTEXT) ---
  if (otherChatsContext) {
    instruction += `--- AKTUELLER KONTEXT ANDERER ROLLEN (Das "Gemeinsame Gehirn") ---\n`;
    instruction += `Das BrainExtender System besteht aus mehreren Agenten (Brillen), die gemeinsam ein Team bilden. Du bist nicht isoliert! Hier ist ein kurzer Live-Einblick in das, was gerade parallel in den anderen offenen Chats mit deinen Kollegen besprochen wird. Beziehe dieses Wissen mit ein, wenn es für deine spezifische Perspektive relevant ist, um ein großes gemeinsames Bild (Heißluftballon-Perspektive) zu formen:\n`;
    instruction += `${otherChatsContext}\n`;
    instruction += `--- ENDE AKTUELLER KONTEXT ---\n\n`;
  }

  // --- DYNAMISCHES AUTO-TUNING ---
  try {
    if (fs.existsSync(DYNAMIC_RULES_FILE)) {
      const dynamicRules = JSON.parse(fs.readFileSync(DYNAMIC_RULES_FILE, 'utf8'));
      let injectedRules = false;
      let rulesText = `--- DYNAMISCHE VERHALTENSREGELN (Benutzer-Vorgaben) ---\n`;
      rulesText += `Beachte diese unumstößlichen, vom Nutzer vorgegebenen Regeln für dein Antwortverhalten:\n`;
      
      if (dynamicRules.global && dynamicRules.global.length > 0) {
        rulesText += `[Globale Regeln]:\n`;
        dynamicRules.global.forEach(r => rulesText += `- ${r}\n`);
        injectedRules = true;
      }
      
      if (dynamicRules.roles && dynamicRules.roles[role] && dynamicRules.roles[role].length > 0) {
        rulesText += `[Rollen-spezifische Regeln für ${role}]:\n`;
        dynamicRules.roles[role].forEach(r => rulesText += `- ${r}\n`);
        injectedRules = true;
      }
      
      if (injectedRules) {
        rulesText += `--- ENDE DYNAMISCHE REGELN ---\n\n`;
        instruction += rulesText;
      }
    }
  } catch(e) {
    console.error("Fehler beim Laden dynamischer Regeln", e);
  }

  // Add low temperature hallucination guard instructions
  const temp = roleObj ? roleObj.temperature : 0.7;
  if (temp <= 0.3) {
    instruction += `WICHTIG: Antworte streng faktisch auf Basis der vorliegenden Daten (Langzeitgedächtnis, Vogelperspektive). Spekuliere nicht und erfinde keine Daten oder Zahlen, die nicht belegt sind. Sage dem Benutzer offen, wenn eine Information fehlt.\n\n`;
  }

  if (memories && memories.length > 0) {
    instruction += `Du hast Zugriff auf das persönliche Langzeitgedächtnis des Benutzers aus früheren Gesprächen und importierten Daten. Nutze dieses Wissen diskret, um Antworten zu personalisieren:\n`;
    instruction += `--- LANGZEITGEDÄCHTNIS ---\n`;
    memories.forEach((mem, index) => {
      const src = mem.metadata.source || 'Unbekannt';
      const time = mem.metadata.timestamp ? new Date(mem.metadata.timestamp).toLocaleDateString('de-DE') : 'Unbekannt';
      instruction += `[Erinnerung #${index + 1}] (Quelle: ${src}, Datum/Zeit: ${time}):\n${mem.text}\n\n`;
    });
    instruction += `--- ENDE LANGZEITGEDÄCHTNIS ---\n\n`;
    instruction += `Beziehe dich auf diese Fakten, wenn sie zur Frage passen. Erwähne im Chat niemals "Erinnerung #1" oder ähnliches, sondern lasse das Wissen vollkommen natürlich einfließen.\n`;
  }

  return instruction;
}

// Fetch financial context, tasks, and facts from local Vogelperspektive API
async function getVogelperspektiveData() {
  try {
    const topicsRes = await fetch(`http://localhost:3000/api/topics`);
    if (!topicsRes.ok) throw new Error("Failed to fetch topics");
    const topics = await topicsRes.json();

    const contexts = await Promise.all(
      topics.map(async (topic) => {
        try {
          const contextRes = await fetch(`http://localhost:3000/api/topics/${topic.id}/context`);
          if (!contextRes.ok) return null;
          return await contextRes.json();
        } catch (err) {
          console.warn(`Failed to fetch context for topic ${topic.title}:`, err.message);
          return null;
        }
      })
    );

    return contexts.filter(c => c !== null);
  } catch (err) {
    console.error("Failed to fetch Vogelperspektive data:", err.message);
    return null;
  }
}

// Build formatted instructions representing Vogelperspektive context
function buildVogelperspektiveInstruction(vogelData) {
  if (!vogelData || vogelData.length === 0) return "";

  let text = `Du hast Zugriff auf aktuelle Finanzzahlen, KFZ-Bestände, Aufgaben und Fakten aus Aurels zentralem Finanz-Dashboard 'Vogelperspektive'. Nutze diese Daten, um ihn strategisch und steuerlich präzise zu beraten. Beziehe dich bei Bedarf auf diese Zahlen, erwähne jedoch im Gespräch nicht explizit "die geladenen API-Daten", sondern lasse sie vollkommen natürlich einfließen:\n\n`;
  text += `--- DATEN AUS VOGELPERSPEKTIVE ---\n`;

  vogelData.forEach(({ topic, facts, tasks }) => {
    text += `### Thema: ${topic.title} (ID: ${topic.id})\n`;
    if (topic.description) text += `Beschreibung: ${topic.description}\n`;

    if (facts && facts.length > 0) {
      text += `Fakten:\n`;
      facts.forEach(fact => {
        text += `- ${fact.content}\n`;
      });
    }

    if (tasks && tasks.length > 0) {
      text += `Aufgaben:\n`;
      tasks.forEach(task => {
        const dueDate = task.due_date ? new Date(task.due_date).toLocaleDateString('de-DE') : 'Kein Datum';
        text += `- [${task.status}] ${task.title} (Fällig: ${dueDate}${task.notes ? `, Info: ${task.notes}` : ''})\n`;
      });
    }
    text += `\n`;
  });

  text += `--- ENDE DATEN AUS VOGELPERSPEKTIVE ---\n\n`;
  return text;
}

// --- Chat Database Helpers ---

let chatsCache = null;
let chatsCacheMtime = 0;

function getChats() {
  try {
    const stats = fs.statSync(CHATS_FILE);
    if (chatsCache && stats.mtimeMs === chatsCacheMtime) {
      return chatsCache;
    }
    const data = fs.readFileSync(CHATS_FILE, 'utf8');
    chatsCache = JSON.parse(data).chats || [];
    chatsCacheMtime = stats.mtimeMs;
    return chatsCache;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error("Error reading chats file:", err);
    return [];
  }
}

function saveChats(chats) {
  try {
    chatsCache = chats;
    fs.writeFileSync(CHATS_FILE, JSON.stringify({ chats }, null, 2));
    chatsCacheMtime = fs.statSync(CHATS_FILE).mtimeMs;
  } catch (err) {
    console.error("Error writing chats file:", err);
  }
}

// Track and update API usage costs in stats.json
function updateCostStats(modelName, inputTokens, outputTokens) {
  try {
    let stats = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUSD: 0,
      monthlyCostUSD: 0,
      currentMonth: new Date().toISOString().substring(0, 7), // Format: YYYY-MM
      totalRequests: 0,
      byModel: {}
    };

    if (fs.existsSync(STATS_FILE)) {
      stats = { ...stats, ...JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) };
    }

    const actualMonth = new Date().toISOString().substring(0, 7);
    if (stats.currentMonth !== actualMonth) {
      stats.currentMonth = actualMonth;
      stats.monthlyCostUSD = 0; // Reset for new month
    }

    // Normalize modelName
    const normModel = modelName.replace('models/', '');

    // Define rates per token (USD)
    let inputRate = 0.00000030; // Default Flash rate ($0.30/1M)
    let outputRate = 0.00000250; // Default Flash rate ($2.50/1M)

    if (normModel.includes('gpt-4o-mini')) {
      inputRate = 0.00000015; // GPT-4o-mini ($0.15/1M)
      outputRate = 0.00000060; // GPT-4o-mini ($0.60/1M)
    } else if (normModel.includes('gpt-4o')) {
      inputRate = 0.00000500; // GPT-4o ($5.00/1M)
      outputRate = 0.00001500; // GPT-4o ($15.00/1M)
    } else if (normModel.includes('claude-3-5')) {
      inputRate = 0.00000300; // Claude 3.5 ($3.00/1M)
      outputRate = 0.00001500; // Claude 3.5 ($15.00/1M)
    } else if (normModel.includes('moonshot')) {
      inputRate = 0.00000150; // Kimi (~$1.50/1M)
      outputRate = 0.00000150; // Kimi (~$1.50/1M)
    } else if (normModel.includes('pro')) {
      inputRate = 0.00000125; // Pro rate ($1.25/1M)
      outputRate = 0.00001000; // Pro rate ($10.00/1M)
    } else if (normModel.includes('flash-lite')) {
      inputRate = 0.000000075; // Flash Lite rate ($0.075/1M)
      outputRate = 0.00000030; // Flash Lite rate ($0.30/1M)
    }

    // Gemini Pricing: Prompts longer than 128k tokens cost exactly double!
    if ((normModel.includes('pro') || normModel.includes('flash')) && inputTokens > 128000) {
      inputRate *= 2;
      outputRate *= 2;
    }

    const requestCost = (inputTokens * inputRate) + (outputTokens * outputRate);

    stats.totalInputTokens += inputTokens;
    stats.totalOutputTokens += outputTokens;
    stats.totalCostUSD += requestCost;
    stats.monthlyCostUSD += requestCost;
    stats.totalRequests += 1;

    if (!stats.byModel[normModel]) {
      stats.byModel[normModel] = {
        inputTokens: 0,
        outputTokens: 0,
        costUSD: 0,
        requests: 0
      };
    }

    stats.byModel[normModel].inputTokens += inputTokens;
    stats.byModel[normModel].outputTokens += outputTokens;
    stats.byModel[normModel].costUSD += requestCost;
    stats.byModel[normModel].requests += 1;

    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    return stats;
  } catch (err) {
    console.error("Error updating cost stats:", err);
  }
}

// Helper to extract API key from header or environment
function getApiKey(req) {
  return req.headers['x-api-key'] || process.env.GEMINI_API_KEY;
}

// --- EXPRESS ENDPOINTS ---

// 1. Config Check
app.get('/api/config', (req, res) => {
  res.json({
    hasApiKey: !!process.env.GEMINI_API_KEY
  });
});

// --- GOOGLE CALENDAR AUTH ROUTES ---

// Redirect to Google's consent screen
app.get('/api/calendar/auth', (req, res) => {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    return res.status(400).send("<h3>Konfigurationsfehler</h3><p>Bitte stellen Sie sicher, dass GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET in der .env-Datei konfiguriert sind.</p>");
  }

  const scopes = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.email',
    'openid'
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes
  });

  res.redirect(authUrl);
});

// Google Calendar OAuth callback handler
app.get('/api/calendar/auth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send("<h3>Fehler</h3><p>Authorization Code fehlt.</p>");
  }

  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    return res.status(500).send("<h3>Konfigurationsfehler</h3>");
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google Kalender verknüpft</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600&family=Inter:wght@400;500&display=swap" rel="stylesheet">
        <style>
          body {
            background-color: hsl(222, 20%, 8%);
            color: hsl(210, 15%, 85%);
            font-family: 'Inter', sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
          }
          .card {
            background-color: hsla(222, 20%, 15%, 0.7);
            border: 1px solid hsla(142, 70%, 45%, 0.35);
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3), 0 0 15px hsla(142, 70%, 45%, 0.1);
            backdrop-filter: blur(12px);
            border-radius: 14px;
            padding: 30px;
            text-align: center;
            max-width: 400px;
          }
          h3 {
            font-family: 'Outfit', sans-serif;
            color: white;
            font-size: 20px;
            margin-top: 0;
            margin-bottom: 10px;
          }
          p {
            font-size: 14px;
            color: hsl(210, 10%, 60%);
            margin-bottom: 20px;
          }
          .btn-close {
            background-color: hsl(142, 70%, 45%);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .btn-close:hover {
            filter: brightness(1.1);
          }
        </style>
      </head>
      <body>
        <div class="card">
          <svg style="width:48px;height:48px;color:hsl(142, 70%, 45%);margin-bottom:15px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <h3>Erfolgreich verknüpft!</h3>
          <p>Der BrainExtender hat nun Zugriff auf Ihren Google Kalender. Sie können dieses Fenster jetzt schließen.</p>
          <button class="btn-close" onclick="window.close()">Fenster schließen</button>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("OAuth token exchange failed:", err);
    res.status(500).send(`<h3>Fehler</h3><p>${err.message}</p>`);
  }
});

// Check status of calendar link
app.get('/api/calendar/status', async (req, res) => {
  const hasCreds = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  if (!hasCreds) {
    return res.json({ connected: false, configured: false });
  }

  const tokenExists = fs.existsSync(TOKENS_FILE);
  if (!tokenExists) {
    return res.json({ connected: false, configured: true });
  }

  try {
    const oauth2Client = getOAuth2Client();
    const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    oauth2Client.setCredentials(tokens);

    let email = null;
    if (tokens.id_token) {
      const ticket = await oauth2Client.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      const payload = ticket.getPayload();
      email = payload.email;
    }

    res.json({
      connected: true,
      configured: true,
      email: email || 'Verknüpft'
    });
  } catch (err) {
    console.warn("Token status check warning:", err.message);
    res.json({ connected: false, configured: true, error: err.message });
  }
});

// Google Calendar disconnect
app.delete('/api/calendar/disconnect', (req, res) => {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      fs.unlinkSync(TOKENS_FILE);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Web Search API endpoint (privacy-first via DuckDuckGo)
app.get('/api/web-search', async (req, res) => {
  const { q, deep } = req.query;
  if (!q) return res.status(400).json({ error: 'Suchbegriff fehlt (Parameter: q)' });

  try {
    const deepScrape = deep !== undefined ? parseInt(deep, 10) : 2;
    const results = await searchDuckDuckGo(q, deepScrape);
    res.json({ query: q, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    if (fs.existsSync(STATS_FILE)) {
      const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
      res.json(stats);
    } else {
      res.json({
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUSD: 0,
        totalRequests: 0,
        byModel: {}
      });
    }
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Lesen der Statistik: " + err.message });
  }
});

// --- DASHBOARD & CEO BOARDROOM API ROUTES ---
const DASHBOARD_FILE = path.join(__dirname, 'data', 'dashboard.json');

app.get('/api/appointments', (req, res) => {
  try {
    if (fs.existsSync(APPOINTMENTS_FILE)) {
      const appointments = JSON.parse(fs.readFileSync(APPOINTMENTS_FILE, 'utf8'));
      // Filter for next 365 days
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const nextWeek = new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000);
      nextWeek.setHours(23, 59, 59, 999);
      
      const filtered = appointments.filter(a => {
        const d = new Date(a.date);
        return d >= today && d <= nextWeek;
      });
      // Sort by date ascending
      filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
      res.json(filtered);
    } else {
      res.json([]);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/todos', (req, res) => {
  try {
    if (fs.existsSync(TODOS_FILE)) {
      res.json(JSON.parse(fs.readFileSync(TODOS_FILE, 'utf8')));
    } else {
      res.json([]);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/todos/:id', (req, res) => {
  try {
    const todoId = req.params.id;
    const { completed } = req.body;
    if (fs.existsSync(TODOS_FILE)) {
      let todos = JSON.parse(fs.readFileSync(TODOS_FILE, 'utf8'));
      const todoIndex = todos.findIndex(t => t.id === todoId);
      if (todoIndex !== -1) {
        todos[todoIndex].completed = completed;
        fs.writeFileSync(TODOS_FILE, JSON.stringify(todos, null, 2));
        return res.json({ success: true, todo: todos[todoIndex] });
      }
    }
    res.status(404).json({ error: "ToDo nicht gefunden" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    let dashboardData = { finance: {}, fitness: {}, coaching: {}, insights: [] };
    if (fs.existsSync(DASHBOARD_FILE)) {
      dashboardData = JSON.parse(fs.readFileSync(DASHBOARD_FILE, 'utf8'));
    }

    // Try to fetch live financial data from LifeDash
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout
      
      const lifeDashRes = await fetch(`http://localhost:3000/api/chart-data`, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (lifeDashRes.ok) {
        const lifeDashData = await lifeDashRes.json();
        // Override the finance object with real data
        dashboardData.finance = {
          labels: lifeDashData.labels || [],
          revenue: lifeDashData.incomeData || [],
          expenses: lifeDashData.expenseData || []
        };
      }
    } catch (fetchErr) {
      console.warn(`LifeDash API (http://localhost:3000/api/chart-data) is unreachable. Using local dashboard.json fallback.`);
    }

    res.json(dashboardData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/dashboard/update', (req, res) => {
  const { type, content } = req.body;
  if (!type || !content) return res.status(400).json({ error: "type und content erforderlich." });
  
  try {
    let dashboardData = { finance: {}, fitness: {}, coaching: {}, insights: [], mindset: [] };
    if (fs.existsSync(DASHBOARD_FILE)) {
      dashboardData = JSON.parse(fs.readFileSync(DASHBOARD_FILE, 'utf8'));
    }
    
    if (type === 'insight') {
      if (!dashboardData.insights) dashboardData.insights = [];
      const today = new Date().toISOString().split('T')[0];
      dashboardData.insights.push({ date: today, text: content });
    } else if (type === 'mindset') {
      if (!dashboardData.mindset) dashboardData.mindset = [];
      dashboardData.mindset.push(content);
    } else {
      return res.status(400).json({ error: "Ungültiger type. Erwartet: 'insight' oder 'mindset'." });
    }
    
    fs.writeFileSync(DASHBOARD_FILE, JSON.stringify(dashboardData, null, 2), 'utf8');
    res.json({ success: true, dashboard: dashboardData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/dashboard/updateChart', (req, res) => {
  const { chartName, labels, dataset1Name, dataset1Data, dataset2Name, dataset2Data } = req.body;
  if (!chartName || !labels || !dataset1Name || !dataset1Data) {
    return res.status(400).json({ error: "Fehlende Parameter für Diagramm-Update." });
  }
  
  try {
    let dashboardData = { finance: {}, fitness: {}, coaching: {}, insights: [], mindset: [] };
    if (fs.existsSync(DASHBOARD_FILE)) {
      dashboardData = JSON.parse(fs.readFileSync(DASHBOARD_FILE, 'utf8'));
    }
    
    if (chartName === 'finance') {
      dashboardData.finance = {
        labels,
        revenue: dataset1Data,
        expenses: dataset2Data || []
      };
    } else if (chartName === 'fitness') {
      dashboardData.fitness = {
        labels,
        weight: dataset1Data,
        workouts: dataset2Data || []
      };
    } else if (chartName === 'coaching') {
      dashboardData.coaching = {
        labels,
        scores: dataset1Data
      };
    } else {
      return res.status(400).json({ error: "Unbekannter Chart-Name." });
    }
    
    fs.writeFileSync(DASHBOARD_FILE, JSON.stringify(dashboardData, null, 2), 'utf8');
    res.json({ success: true, dashboard: dashboardData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/boardroom/consult', async (req, res) => {
  const { question, roleKeys } = req.body;
  if (!question || !roleKeys || !Array.isArray(roleKeys)) {
    return res.status(400).json({ error: "question und roleKeys erforderlich." });
  }

  const apiKey = req.headers['x-api-key'] || process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(401).json({ error: "Gemini API-Schlüssel fehlt." });

  try {
    const roles = getRoles();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

    const promises = roleKeys.map(async (key) => {
      const role = roles[key];
      if (!role) return { role: key, error: "Rolle nicht gefunden" };
      
      const prompt = `Du bist in einem 'CEO Boardroom' Meeting. Als ${role.title} (${role.description}), beantworte bitte folgende strategische Frage aus deiner spezifischen Perspektive prägnant und messerscharf. Deine Systemanweisung ist: ${role.systemPrompt}\n\nFrage des CEO: ${question}`;
      
      try {
        const result = await model.generateContent(prompt);
        return { role: key, title: role.title, icon: role.icon, response: result.response.text() };
      } catch (err) {
        return { role: key, title: role.title, icon: role.icon, error: err.message };
      }
    });

    const results = await Promise.all(promises);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const APPOINTMENTS_FILE = path.join(__dirname, 'data', 'appointments.json');
const TODOS_FILE = path.join(__dirname, 'data', 'todos.json');
const DYNAMIC_RULES_FILE = path.join(__dirname, 'data', 'dynamic_rules.json');

// Execute write action in local Vogelperspektive API and log to chat history
app.post('/api/vogelperspektive/write', async (req, res) => {
  let { action } = req.body;
  const { topicId, title, content, due_date, notes, chatId, tasks } = req.body;

  try {
    let apiResponse;
    if (action === 'addFact') {
      const resApi = await fetch(`http://localhost:3000/api/topics/${topicId}/facts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      if (!resApi.ok) throw new Error("Fehler beim Schreiben des Fakts in Vogelperspektive");
      apiResponse = await resApi.json();
    } else if (action === 'addTask') {
      const resApi = await fetch(`http://localhost:3000/api/topics/${topicId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, due_date: due_date || null, notes: notes || '' })
      });
      if (!resApi.ok) throw new Error("Fehler beim Schreiben der Aufgabe in Vogelperspektive");
      apiResponse = await resApi.json();
    } else if (action === 'createCalendarEvent') {
      let calendar;
      try {
        calendar = await getCalendarClient();
      } catch (authErr) {
        console.warn('Kalender-Verbindung fehlt. Weiche auf lokales Dashboard aus:', authErr.message);
        
        // Fallback to local dashboard
        let appointments = [];
        if (fs.existsSync(APPOINTMENTS_FILE)) {
          appointments = JSON.parse(fs.readFileSync(APPOINTMENTS_FILE, 'utf8'));
        }
        const newAppt = {
          id: uuidv4(),
          title: title || 'Termin (aus Chat)',
          date: due_date || new Date().toISOString(),
          description: notes || '',
          createdAt: new Date().toISOString()
        };
        if (tasks && tasks.length > 0) {
          newAppt.description += (newAppt.description ? '\n\n' : '') + 'Checkliste:\n' + tasks.map(t => `- [ ] ${t}`).join('\n');
        }
        appointments.push(newAppt);
        fs.writeFileSync(APPOINTMENTS_FILE, JSON.stringify(appointments, null, 2));
        apiResponse = newAppt;
        
        // Trick the logger at the bottom into thinking this was a manageAppointment action
        action = 'manageAppointment'; 
      }

      if (calendar) {
        const start = { dateTime: due_date };
        
        let end;
        if (req.body.endDateTime) {
          end = { dateTime: req.body.endDateTime };
        } else {
          const startDate = new Date(due_date);
          const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // + 1 hour
          end = { dateTime: endDate.toISOString() };
        }

        let descriptionContent = notes || '';
        if (tasks && tasks.length > 0) {
          if (descriptionContent) descriptionContent += '\n\n';
          descriptionContent += 'Checkliste:\n' + tasks.map(t => `- [ ] ${t}`).join('\n');
        }

        const event = {
          summary: title,
          description: descriptionContent,
          start,
          end,
        };

        const response = await calendar.events.insert({
          calendarId: 'primary',
          resource: event,
        });

        apiResponse = response.data;
      }
    } else if (action === 'manageAppointment') {
      let appointments = [];
      if (fs.existsSync(APPOINTMENTS_FILE)) {
        appointments = JSON.parse(fs.readFileSync(APPOINTMENTS_FILE, 'utf8'));
      }
      const newAppt = {
        id: uuidv4(),
        title,
        date: due_date,
        description: notes || '',
        createdAt: new Date().toISOString()
      };
      appointments.push(newAppt);
      fs.writeFileSync(APPOINTMENTS_FILE, JSON.stringify(appointments, null, 2));
      apiResponse = newAppt;
    } else if (action === 'manageTodo') {
      let todos = [];
      if (fs.existsSync(TODOS_FILE)) {
        todos = JSON.parse(fs.readFileSync(TODOS_FILE, 'utf8'));
      }
      
      const todoAction = req.body.todoAction; // 'add', 'complete', 'delete'
      if (todoAction === 'add') {
        const newTodo = {
          id: uuidv4(),
          title,
          description: notes || '',
          completed: false,
          createdAt: new Date().toISOString()
        };
        todos.push(newTodo);
        apiResponse = newTodo;
      } else if (todoAction === 'complete' || todoAction === 'delete') {
        // Find by title roughly
        const idx = todos.findIndex(t => t.title.toLowerCase() === title.toLowerCase());
        if (idx !== -1) {
          if (todoAction === 'complete') {
            todos[idx].completed = true;
          } else {
            todos.splice(idx, 1);
          }
        }
        apiResponse = { success: true };
      }
      fs.writeFileSync(TODOS_FILE, JSON.stringify(todos, null, 2));
    } else if (action === 'optimizeBehavior') {
      let rules = { global: [], roles: {}, rag_strategy: {} };
      if (fs.existsSync(DYNAMIC_RULES_FILE)) {
        rules = JSON.parse(fs.readFileSync(DYNAMIC_RULES_FILE, 'utf8'));
      }
      
      const scope = req.body.scope || 'global';
      const ruleText = req.body.rule || '';
      const optimizeAction = req.body.optimizeAction || 'add';
      
      if (ruleText) {
        if (scope === 'global') {
          if (optimizeAction === 'add' && !rules.global.includes(ruleText)) rules.global.push(ruleText);
          else if (optimizeAction === 'remove') rules.global = rules.global.filter(r => r !== ruleText);
        } else {
          if (!rules.roles[scope]) rules.roles[scope] = [];
          if (optimizeAction === 'add' && !rules.roles[scope].includes(ruleText)) rules.roles[scope].push(ruleText);
          else if (optimizeAction === 'remove') rules.roles[scope] = rules.roles[scope].filter(r => r !== ruleText);
        }
      }
      
      if (req.body.topK !== undefined) rules.rag_strategy.topK = parseInt(req.body.topK);
      if (req.body.minSimilarity !== undefined) rules.rag_strategy.minSimilarity = parseFloat(req.body.minSimilarity);
      
      fs.writeFileSync(DYNAMIC_RULES_FILE, JSON.stringify(rules, null, 2));
      apiResponse = { success: true, scope, rule: ruleText };
    } else {
      return res.status(400).json({ error: "Ungültige Aktion" });
    }

    // Log successful write in chat history if chatId is provided
    if (chatId) {
      const chats = getChats();
      const chat = chats.find(c => c.id === chatId);
      if (chat) {
        let logContent = '';
        if (action === 'addFact') logContent = `*System-Notiz: Fakt wurde ins Knowledge-Base-Thema "${topicId}" gespeichert.*`;
        else if (action === 'addTask') logContent = `*System-Notiz: Aufgabe "${title}" wurde ins Knowledge-Base-Thema "${topicId}" eingetragen.*`;
        else if (action === 'createCalendarEvent') logContent = `*System-Notiz: Termin "${title}" wurde im Google Kalender eingetragen.*`;
        else if (action === 'manageAppointment') logContent = `*System-Notiz: Termin "${title}" am ${due_date} wurde im Dashboard gespeichert.*`;
        else if (action === 'manageTodo') logContent = `*System-Notiz: ToDo-Aktion "${req.body.todoAction}" für "${title}" wurde ausgeführt.*`;
        else if (action === 'optimizeBehavior') logContent = `*System-Notiz: Verhaltensregel dauerhaft gespeichert (Scope: ${req.body.scope}).*`;

        chat.messages.push({
          id: uuidv4(),
          role: 'model',
          content: `✓ **Erfolgreich eingetragen:**\n\n${logContent}`,
          timestamp: new Date().toISOString()
        });
        saveChats(chats);
      }
    }

    res.json({ success: true, data: apiResponse });
  } catch (err) {
    console.error("Write error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- AUDIO API ROUTES ---
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No audio file provided" });
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing in .env");
    
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const whisperParams = {
      file: fs.createReadStream(req.file.path),
      model: "whisper-1",
      prompt: "Das ist ein Sprachtraining. Russisch wird in kyrillischen Buchstaben geschrieben, z.B. Здравствуйте, спасибо, хорошо. Deutsch wird normal geschrieben."
    };
    
    if (req.body.language) {
      whisperParams.language = req.body.language;
    }
    
    const transcription = await openai.audio.transcriptions.create(whisperParams);
    
    // Cleanup temporary audio file
    fs.unlinkSync(req.file.path);
    
    res.json({ text: transcription.text });
  } catch (err) {
    console.error("Transcription error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice = 'nova', speed = 1.0 } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing in .env");
    
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: voice,
      input: text,
      speed: parseFloat(speed)
    });
    
    const buffer = Buffer.from(await mp3.arrayBuffer());
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length
    });
    res.send(buffer);
  } catch (err) {
    console.error("TTS error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- MODELS API ROUTES ---
app.get('/api/models', (req, res) => {
  try {
    const models = getModels();
    res.json(models);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Laden der Modelle." });
  }
});

app.post('/api/models', (req, res) => {
  try {
    const { id, name } = req.body;
    if (!id || !name) return res.status(400).json({ error: "id and name required" });
    
    const models = getModels();
    if (!models.find(m => m.id === id)) {
      models.push({ id, name });
      saveModels(models);
    }
    res.json({ success: true, models });
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Speichern des Modells." });
  }
});

// --- ROLES API ROUTES ---

// 1. Get all roles
app.get('/api/roles', (req, res) => {
  try {
    const roles = getRoles();
    res.json(roles);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Laden der Rollen: " + err.message });
  }
});

// 2. Add a new role
app.post('/api/roles', (req, res) => {
  const { key, title, description, systemPrompt, temperature, icon } = req.body;
  if (!key || !title || !systemPrompt) {
    return res.status(400).json({ error: "Key, Titel und System-Prompt sind erforderlich." });
  }
  // Sanitize key (only alphanumeric/underscore)
  const sanitizedKey = key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!sanitizedKey) {
    return res.status(400).json({ error: "Ungültiger Key. Nutzen Sie nur Kleinbuchstaben, Zahlen und Unterstriche." });
  }

  try {
    const roles = getRoles();
    if (roles[sanitizedKey]) {
      return res.status(400).json({ error: "Eine Rolle mit diesem Key existiert bereits." });
    }

    roles[sanitizedKey] = {
      title: title.trim(),
      description: (description || '').trim(),
      systemPrompt: systemPrompt.trim(),
      temperature: typeof temperature !== 'undefined' ? parseFloat(temperature) : 0.7,
      icon: (icon || 'fa-user').trim(),
      contextStrategy: req.body.contextStrategy || '30',
      isSystem: false
    };

    saveRoles(roles);
    res.status(201).json(roles[sanitizedKey]);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Erstellen der Rolle: " + err.message });
  }
});

// 3. Edit an existing role
app.put('/api/roles/:key', (req, res) => {
  const { key } = req.params;
  const { title, description, systemPrompt, temperature, icon } = req.body;

  try {
    const roles = getRoles();
    const role = roles[key];
    if (!role) {
      return res.status(404).json({ error: "Rolle nicht gefunden." });
    }

    if (title) role.title = title.trim();
    if (description !== undefined) role.description = description.trim();
    if (systemPrompt) role.systemPrompt = systemPrompt.trim();
    if (temperature !== undefined) role.temperature = parseFloat(temperature);
    if (icon) role.icon = icon.trim();
    if (req.body.contextStrategy) role.contextStrategy = req.body.contextStrategy;

    saveRoles(roles);
    res.json(role);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Aktualisieren der Rolle: " + err.message });
  }
});

// 4. Delete a custom role
app.delete('/api/roles/:key', (req, res) => {
  const { key } = req.params;

  try {
    const roles = getRoles();
    const role = roles[key];
    if (!role) {
      return res.status(404).json({ error: "Rolle nicht gefunden." });
    }

    if (role.isSystem) {
      return res.status(400).json({ error: "System-Rollen können nicht gelöscht werden." });
    }

    delete roles[key];
    saveRoles(roles);
    res.json({ success: true, message: "Rolle gelöscht." });
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Löschen der Rolle: " + err.message });
  }
});

// 5. Reset roles to defaults
app.post('/api/roles/reset', (req, res) => {
  try {
    saveRoles(DEFAULT_ROLES);
    res.json({ success: true, message: "Standard-Rollen wiederhergestellt.", roles: DEFAULT_ROLES });
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Zurücksetzen der Rollen: " + err.message });
  }
});

// Update API key locally
app.post('/api/config', (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: "API-Key fehlt" });

  try {
    let envContent = '';
    if (fs.existsSync(path.join(__dirname, '.env'))) {
      envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    }

    // Replace or add GEMINI_API_KEY
    if (envContent.includes('GEMINI_API_KEY=')) {
      envContent = envContent.replace(/GEMINI_API_KEY=.*/, `GEMINI_API_KEY=${apiKey}`);
    } else {
      envContent += `\nGEMINI_API_KEY=${apiKey}`;
    }

    fs.writeFileSync(path.join(__dirname, '.env'), envContent.trim() + '\n');
    process.env.GEMINI_API_KEY = apiKey;
    res.json({ success: true, message: "API-Key lokal in .env gespeichert" });
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Schreiben der .env-Datei: " + err.message });
  }
});

// 2. Chats CRUD
app.get('/api/chats', (req, res) => {
  const chats = getChats().map(chat => ({
    id: chat.id,
    title: chat.title,
    role: chat.role || 'standard',
    tone: chat.tone || 'neutral',
    model: chat.model || 'gemini-2.5-pro',
    createdAt: chat.createdAt
  }));
  res.json(chats);
});

app.post('/api/chats', (req, res) => {
  const { title, role, tone, model } = req.body;
  const chats = getChats();
  const newChat = {
    id: uuidv4(),
    title: title || "Neuer Chat",
    role: role || 'standard',
    tone: tone || 'neutral',
    model: model || 'gemini-2.5-pro',
    createdAt: new Date().toISOString(),
    messages: []
  };
  chats.push(newChat);
  saveChats(chats);
  res.status(201).json(newChat);
});

app.get('/api/chats/:id', (req, res) => {
  const chats = getChats();
  const chat = chats.find(c => c.id === req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat nicht gefunden" });
  res.json(chat);
});

app.delete('/api/chats/:id', (req, res) => {
  let chats = getChats();
  const initialLength = chats.length;
  chats = chats.filter(c => c.id !== req.params.id);
  if (chats.length === initialLength) {
    return res.status(404).json({ error: "Chat nicht gefunden" });
  }
  saveChats(chats);
  res.json({ success: true, message: "Chat gelöscht" });
});

// Update chat properties dynamically
app.patch('/api/chats/:id', (req, res) => {
  const chatId = req.params.id;
  const { model, role, tone, title } = req.body;
  const chats = getChats();
  const chat = chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).json({ error: "Chat nicht gefunden" });

  if (model) chat.model = model;
  if (role) chat.role = role;
  if (tone) chat.tone = tone;
  if (title) chat.title = title;

  saveChats(chats);
  res.json(chat);
});

// Create a new chat via Handover Briefing
app.post('/api/chats/:id/handover', async (req, res) => {
  const sourceChatId = req.params.id;
  const { targetRole } = req.body;
  
  if (!targetRole) return res.status(400).json({ error: "targetRole erforderlich." });
  
  const chats = getChats();
  const sourceChat = chats.find(c => c.id === sourceChatId);
  if (!sourceChat) return res.status(404).json({ error: "Ursprungs-Chat nicht gefunden." });

  const apiKey = req.headers['x-api-key'] || process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(401).json({ error: "Gemini API-Schlüssel fehlt." });

  try {
    const roles = getRoles();
    const targetRoleData = roles[targetRole];
    if (!targetRoleData) return res.status(400).json({ error: "Ziel-Rolle nicht gefunden." });

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

    // Format history
    let historyText = sourceChat.messages.map(m => `${m.role === 'user' ? 'User' : 'KI'}: ${m.content}`).join('\n\n');
    
    // Fallback if history is too long (basic truncation)
    if (historyText.length > 30000) {
      historyText = historyText.substring(historyText.length - 30000);
    }

    const prompt = `Analysiere den folgenden Chatverlauf und erstelle ein messerscharfes Übergabe-Briefing für einen '${targetRoleData.title}' (${targetRoleData.description}).\n\nFasse die Intention, das Kernproblem und die bereits erarbeitete Strategie so zusammen, dass der ${targetRoleData.title} direkt nahtlos weiterarbeiten kann. Formuliere es als direkte Ansprache an den ${targetRoleData.title}.\n\n--- CHATVERLAUF ---\n${historyText}`;

    const result = await model.generateContent(prompt);
    const briefingText = result.response.text();

    // Create new chat
    const newChat = {
      id: Math.random().toString(36).substr(2, 9),
      title: `Handover: ${sourceChat.title}`,
      createdAt: new Date().toISOString(),
      role: targetRole,
      tone: 'neutral',
      model: sourceChat.model,
      messages: [
        {
          id: Math.random().toString(36).substr(2, 9),
          role: 'model', // We put it as a model message so it acts as context without the user having to type it
          content: `**[SYSTEM-HANDOVER BRIEFING AUS VORHERIGEM CHAT]**\n\n${briefingText}\n\n*Ich bin nun als ${targetRoleData.title} bereit. Womit sollen wir fortfahren?*`
        }
      ]
    };

    chats.push(newChat);
    saveChats(chats);
    
    res.json({ success: true, newChatId: newChat.id });
  } catch (err) {
    console.error("Handover Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Vector Memory Management
app.get('/api/memory', (req, res) => {
  const { q } = req.query;
  const memories = getMemories();

  if (!q) {
    // Return all memories but slice embeddings for performance
    return res.json(memories.map(({ embedding, ...rest }) => rest));
  }

  res.json(memories.filter(m => m.text.toLowerCase().includes(q.toLowerCase())).map(({ embedding, ...rest }) => rest));
});

// Search memories directly with vector similarity
app.post('/api/memory/search', async (req, res) => {
  const { query, threshold, topK } = req.body;
  const apiKey = getApiKey(req);

  if (!apiKey) return res.status(401).json({ error: "Gemini API-Schlüssel fehlt. Bitte konfigurieren." });
  if (!query) return res.status(400).json({ error: "Suchbegriff fehlt." });

  try {
    const qEmbed = await getEmbedding(query, apiKey);
    const memories = getMemories();
    const results = searchMemories(qEmbed, memories, topK || 10, threshold || 0.4);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/memory/:id', (req, res) => {
  let memories = getMemories();
  const initialLength = memories.length;
  memories = memories.filter(m => m.id !== req.params.id);
  if (memories.length === initialLength) {
    return res.status(404).json({ error: "Speichereintrag nicht gefunden" });
  }
  saveMemories(memories);
  res.json({ success: true, message: "Erinnerung gelöscht" });
});

app.post('/api/memory/clear', (req, res) => {
  saveMemories([]);
  res.json({ success: true, message: "Gesamtes Gedächtnis gelöscht" });
});

// 4. Gemini Import Route
app.post('/api/memory/import', upload.single('file'), async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(401).json({ error: "Gemini API-Schlüssel fehlt." });
  }
  if (!req.file) return res.status(400).json({ error: "Keine Datei hochgeladen." });

  // Stream progress back via HTTP chunked transfer
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendProgress = (step, current, total, msg) => {
    res.write(JSON.stringify({ step, current, total, msg }) + "\n");
  };

  try {
    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const analyzeImages = req.body.analyzeImages === 'true';

    let rawItems = [];

    if (fileName.endsWith('.zip')) {
      // --- WhatsApp ZIP Export ---
      sendProgress('parse', 0, 0, 'Entpacke ZIP-Archiv...');
      const zip = new AdmZip(filePath);
      const entries = zip.getEntries();

      // Find WhatsApp chat text file
      const chatEntry = entries.find(e =>
        e.entryName.endsWith('_chat.txt') ||
        e.entryName.toLowerCase().includes('chat') && e.entryName.endsWith('.txt')
      );

      if (!chatEntry) {
        fs.unlinkSync(filePath);
        return res.end(JSON.stringify({ error: 'Keine WhatsApp _chat.txt im ZIP-Archiv gefunden.' }));
      }

      sendProgress('parse', 0, 0, `Lese ${chatEntry.entryName}...`);
      const chatText = chatEntry.getData().toString('utf8');
      rawItems = parseWhatsAppChat(chatText, fileName);

      // Optionally analyze images with Gemini Vision
      if (analyzeImages) {
        const imageEntries = entries.filter(e => {
          const n = e.entryName.toLowerCase();
          return (n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.png') || n.endsWith('.webp')) && !e.isDirectory;
        });

        sendProgress('images', 0, imageEntries.length, `${imageEntries.length} Bilder gefunden. Analysiere mit Gemini Vision...`);

        let imgDone = 0;
        for (const imgEntry of imageEntries) {
          try {
            const imgData = imgEntry.getData();
            const mimeType = imgEntry.entryName.toLowerCase().endsWith('.png') ? 'image/png' :
                             imgEntry.entryName.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg';
            const description = await analyzeImageWithGemini(imgData, mimeType, apiKey);
            if (description) {
              rawItems.push({
                text: `[WhatsApp Bild: ${imgEntry.entryName}]\n${description}`,
                timestamp: new Date().toISOString()
              });
            }
          } catch (imgErr) {
            console.warn(`Bild ${imgEntry.entryName} konnte nicht analysiert werden:`, imgErr.message);
          }
          imgDone++;
          sendProgress('images', imgDone, imageEntries.length, `Bild ${imgDone}/${imageEntries.length} analysiert...`);
          // Throttle to avoid rate limits
          await new Promise(r => setTimeout(r, 1500));
        }
      }

    } else {
      const fileContent = fs.readFileSync(filePath, 'utf8');

      if (fileName.endsWith('.json')) {
        sendProgress('parse', 0, 0, 'Analysiere JSON-Struktur...');
        const data = JSON.parse(fileContent);
        rawItems = parseGeminiExport(data);
      } else if (fileName.endsWith('.html') || fileName.endsWith('.htm')) {
        sendProgress('parse', 0, 0, 'Analysiere HTML-Chatverlauf...');
        rawItems = parseHtmlExport(fileContent);
      } else {
        // Plain text or markdown
        sendProgress('parse', 0, 0, 'Analysiere Textdokument...');
        const chunks = chunkText(fileContent, 3000, 500);
        rawItems = chunks.map(chunk => ({
          text: chunk,
          timestamp: new Date().toISOString()
        }));
      }
    }

    if (rawItems.length === 0) {
      fs.unlinkSync(filePath);
      return res.end(JSON.stringify({ error: "Keine importierbaren Inhalte gefunden." }));
    }

    sendProgress('embed_start', 0, rawItems.length, `${rawItems.length} Abschnitte gefunden. Starte Einbettung...`);

    const memories = getMemories();
    const batchSize = 10;

    for (let i = 0; i < rawItems.length; i += batchSize) {
      const batch = rawItems.slice(i, i + batchSize);

      // Process batch
      const promises = batch.map(async (item) => {
        try {
          const embedding = await getEmbeddingWithRetry(item.text, apiKey);
          return {
            id: uuidv4(),
            text: item.text,
            embedding,
            metadata: {
              source: fileName,
              timestamp: item.timestamp || new Date().toISOString()
            }
          };
        } catch (err) {
          console.error("Failed to embed chunk:", err.message);
          return null; // Skip failed chunk
        }
      });

      const embeddedBatch = (await Promise.all(promises)).filter(x => x !== null);
      memories.push(...embeddedBatch);
      saveMemories(memories);

      const currentProgress = Math.min(i + batchSize, rawItems.length);
      sendProgress('embed_progress', currentProgress, rawItems.length, `${currentProgress}/${rawItems.length} Abschnitte verarbeitet...`);

      // Rate-limit throttle to prevent 429
      if (i + batchSize < rawItems.length) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    fs.unlinkSync(filePath); // delete temp file
    res.write(JSON.stringify({ success: true, message: `Erfolgreich ${rawItems.length} Abschnitte importiert.` }) + "\n");
    res.end();
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.write(JSON.stringify({ error: err.message }) + "\n");
    res.end();
  }
});

// Helper for Gemini Export formats
// WhatsApp Chat Export Parser
// Supports both formats:
//   [DD.MM.YY, HH:MM:SS] Name: Message  (newer)
//   DD.MM.YY, HH:MM - Name: Message     (older)
function parseWhatsAppChat(text, sourceFileName) {
  const items = [];

  // Normalize line endings
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Two regex patterns for both WhatsApp export formats
  const newFormat = /^\[(\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^:]+):\s*(.*)$/;
  const oldFormat = /^(\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}),\s*(\d{1,2}:\d{2})\s*[-–]\s*([^:]+):\s*(.*)$/;

  // Media placeholder patterns (German + English)
  const mediaPlaceholders = [
    '<Medien weggelassen>', '<Media omitted>',
    '<image omitted>', '<video omitted>', '<audio omitted>',
    '<document omitted>', '<sticker omitted>',
    'Bild weggelassen', 'Datei weggelassen'
  ];

  // Accumulate multi-line messages
  const messages = [];
  let currentMsg = null;

  for (const line of lines) {
    const matchNew = newFormat.exec(line);
    const matchOld = !matchNew ? oldFormat.exec(line) : null;
    const match = matchNew || matchOld;

    if (match) {
      if (currentMsg) messages.push(currentMsg);
      const [, date, time, sender, content] = match;
      currentMsg = { date, time, sender: sender.trim(), content: content.trim() };
    } else if (currentMsg && line.trim()) {
      // Multi-line message continuation
      currentMsg.content += '\n' + line.trim();
    }
  }
  if (currentMsg) messages.push(currentMsg);

  if (messages.length === 0) return [];

  // Group messages into conversation blocks (sliding window of ~8-12 messages)
  // to create meaningful context chunks for embedding
  const windowSize = 10;
  const stepSize = 5;

  // Also collect per-sender summaries
  const senderMap = {};
  for (const msg of messages) {
    if (!senderMap[msg.sender]) senderMap[msg.sender] = [];
    const isMedia = mediaPlaceholders.some(p => msg.content.includes(p));
    if (!isMedia && msg.content.length > 1) {
      senderMap[msg.sender].push(msg.content);
    }
  }

  const participants = Object.keys(senderMap);
  const chatName = sourceFileName.replace('.zip', '').replace('WhatsApp-Chat-', '').replace('WhatsApp Chat with ', '');

  // Add a metadata summary chunk first
  items.push({
    text: `WhatsApp-Chatverlauf: "${chatName}"\nTeilnehmer: ${participants.join(', ')}\nAnzahl Nachrichten: ${messages.length}\nZeitraum: ${messages[0]?.date || '?'} bis ${messages[messages.length - 1]?.date || '?'}`,
    timestamp: new Date().toISOString()
  });

  // Sliding window chunks
  for (let i = 0; i < messages.length; i += stepSize) {
    const window = messages.slice(i, i + windowSize);
    const chunkLines = window
      .filter(m => !mediaPlaceholders.some(p => m.content.includes(p)))
      .map(m => `[${m.date} ${m.time}] ${m.sender}: ${m.content}`)
      .join('\n');

    if (chunkLines.trim().length > 30) {
      // Parse timestamp for the chunk
      const firstMsg = window[0];
      let ts = new Date().toISOString();
      try {
        const parts = firstMsg.date.split(/[.\/-]/);
        if (parts.length === 3) {
          // Try to parse DD.MM.YY or DD.MM.YYYY
          const day = parseInt(parts[0]);
          const month = parseInt(parts[1]) - 1;
          const year = parseInt(parts[2]) < 100 ? 2000 + parseInt(parts[2]) : parseInt(parts[2]);
          const timeParts = firstMsg.time.split(':');
          ts = new Date(year, month, day, parseInt(timeParts[0]), parseInt(timeParts[1])).toISOString();
        }
      } catch (e) { /* use default */ }

      items.push({ text: chunkLines, timestamp: ts });
    }
  }

  return items;
}

// Analyze a single image with Gemini Vision and return a text description
async function analyzeImageWithGemini(imageBuffer, mimeType, apiKey) {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent([
      {
        inlineData: {
          data: imageBuffer.toString('base64'),
          mimeType
        }
      },
      { text: 'Beschreibe dieses Bild kurz und präzise auf Deutsch. Erwähne alle relevanten Personen, Orte, Objekte und Texte die du siehst. Maximal 3 Sätze.' }
    ]);
    return result.response.text().trim();
  } catch (err) {
    console.warn('Gemini Vision failed:', err.message);
    return null;
  }
}

function parseGeminiExport(data) {
  const items = [];

  if (Array.isArray(data)) {
    for (const chat of data) {
      if (chat.conversations && Array.isArray(chat.conversations)) {
        // Google Takeout Gemini format
        for (const turn of chat.conversations) {
          const prompt = turn.prompt || "";
          const response = turn.response || "";
          if (prompt || response) {
            items.push({
              text: `Frage: ${prompt}\nAntwort: ${response}`,
              timestamp: turn.timestamp || new Date().toISOString()
            });
          }
        }
      } else if (chat.mapping) {
        // ChatGPT Export format
        for (const key in chat.mapping) {
          const node = chat.mapping[key];
          if (node.message && node.message.content && node.message.content.parts) {
            const text = node.message.content.parts.join("\n").trim();
            const role = node.message.author.role;
            if (text && (role === "user" || role === "assistant")) {
              items.push({
                text: `${role === "user" ? "Frage" : "Antwort"}: ${text}`,
                timestamp: node.message.create_time ? new Date(node.message.create_time * 1000).toISOString() : new Date().toISOString()
              });
            }
          }
        }
      } else if (chat.role && chat.content) {
        // Generic message list
        items.push({
          text: `${chat.role === "user" ? "Frage" : "Antwort"}: ${chat.content}`,
          timestamp: chat.timestamp || new Date().toISOString()
        });
      }
    }
  } else if (data && typeof data === 'object') {
    if (data.conversations && Array.isArray(data.conversations)) {
      return parseGeminiExport(data.conversations);
    }
  }

  return items;
}

// Helper to parse HTML chat exports (like Takeout html or saved browser page)
function parseHtmlExport(htmlContent) {
  const items = [];

  // Strip head, script, and style tags to avoid noise
  let bodyContent = htmlContent
    .replace(/<head>([\s\S]*?)<\/head>/gi, '')
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '');

  // Match elements with classes commonly containing message roles
  // user/prompt/query -> User
  // model/response/assistant -> AI
  const tagRegex = /<(div|p|li)[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/gi;
  const tagRemover = /<[^>]*>/g;

  let match;
  const parsedTurns = [];

  while ((match = tagRegex.exec(bodyContent)) !== null) {
    const className = match[2].toLowerCase();
    const content = match[3].replace(tagRemover, ' ').replace(/\s+/g, ' ').trim();

    if (!content) continue;

    let role = null;
    if (className.includes('user') || className.includes('prompt') || className.includes('query')) {
      role = 'user';
    } else if (className.includes('model') || className.includes('response') || className.includes('assistant')) {
      role = 'model';
    }

    if (role) {
      parsedTurns.push({ role, text: content });
    }
  }

  // Pair up alternating user/model turns
  for (let i = 0; i < parsedTurns.length; i++) {
    const turn = parsedTurns[i];
    if (turn.role === 'user') {
      const nextModel = parsedTurns.slice(i + 1).find(t => t.role === 'model');
      if (nextModel) {
        items.push({
          text: `Frage: ${turn.text}\nAntwort: ${nextModel.text}`,
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  // Alternative: Line-based conversation prefix markers (e.g. "User:...", "Gemini:...")
  if (items.length === 0) {
    const lineRegex = /<(li|p)[^>]*>([\s\S]*?)<\/\1>/gi;
    const lines = [];
    while ((match = lineRegex.exec(bodyContent)) !== null) {
      const text = match[2].replace(tagRemover, ' ').replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.toLowerCase().startsWith('user:') || line.toLowerCase().startsWith('frage:')) {
        const promptText = line.replace(/^(user|frage):/i, '').trim();
        const nextLine = lines[i + 1] || "";
        if (nextLine.toLowerCase().startsWith('gemini:') || nextLine.toLowerCase().startsWith('antwort:') || nextLine.toLowerCase().startsWith('model:')) {
          const responseText = nextLine.replace(/^(gemini|antwort|model):/i, '').trim();
          items.push({
            text: `Frage: ${promptText}\nAntwort: ${responseText}`,
            timestamp: new Date().toISOString()
          });
          i++; // Skip paired response line
        }
      }
    }
  }

  // Fallback: Strip all html tags and chunk text
  if (items.length === 0) {
    const textOnly = bodyContent
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const chunks = chunkText(textOnly, 3000, 500);
    chunks.forEach(chunk => {
      items.push({
        text: chunk,
        timestamp: new Date().toISOString()
      });
    });
  }

  return items;
}

// 5. Send Message Stream (Express SSE)
app.post('/api/chats/:id/message', upload.array('files'), async (req, res) => {
  const chatId = req.params.id;
  const { content, useMemory, autoLearn, useVogelperspektive, useWebSearch, contextMethod } = req.body;
  const apiKey = getApiKey(req);

  if (!apiKey) return res.status(401).json({ error: "Gemini API-Schlüssel fehlt." });

  const chats = getChats();
  const chat = chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).json({ error: "Chat nicht gefunden." });

  // Set headers for Streaming Response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let isAborted = false;
  req.on('aborted', () => {
    isAborted = true;
  });
  res.on('close', () => {
    isAborted = true;
  });

  const filesMetadata = [];
  const apiParts = [];

  // 1. Process files if uploaded
  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
      const fileMeta = {
        name: file.originalname,
        path: `/uploads/${file.filename}`,
        mimeType: file.mimetype
      };
      filesMetadata.push(fileMeta);

      // Read file and convert to base64 for Gemini multimodal input, or extract text if docx
      if (file.originalname.toLowerCase().endsWith('.docx') || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        try {
          const result = await mammoth.convertToHtml({ path: file.path });
          apiParts.push({ text: `\n--- [Start Dokument (HTML): ${file.originalname}] ---\n${result.value}\n--- [Ende Dokument] ---\n` });
        } catch (err) {
          console.error("Fehler beim Parsen der DOCX Datei:", err);
          apiParts.push({ text: `[Fehler beim Lesen von ${file.originalname}]` });
        }
      } else {
        const fileData = fs.readFileSync(file.path).toString("base64");
        apiParts.push({
          inlineData: {
            data: fileData,
            mimeType: file.mimetype
          }
        });
      }
    }
  }

  // Add user prompt text
  if (content) {
    apiParts.push({ text: content });
  }

  // Append new user message to local database
  const userMsgId = uuidv4();
  const userMessage = {
    id: userMsgId,
    role: 'user',
    content: content || "",
    files: filesMetadata,
    timestamp: new Date().toISOString()
  };
  chat.messages.push(userMessage);
  saveChats(chats);

  // --- OLLAMA ROUTER INJECTION REMOVED ---
  // Always routing to Gemini for maximum capability.

  // Search vector memory if activated
  let recalledMemories = [];
  if (useMemory === 'true' && content) {
    try {
      // Load dynamic rag strategy if available
      let topK = 3;
      let minSimilarity = 0.45;
      if (fs.existsSync(DYNAMIC_RULES_FILE)) {
        const rules = JSON.parse(fs.readFileSync(DYNAMIC_RULES_FILE, 'utf8'));
        if (rules.rag_strategy) {
          if (rules.rag_strategy.topK !== undefined) topK = rules.rag_strategy.topK;
          if (rules.rag_strategy.minSimilarity !== undefined) minSimilarity = rules.rag_strategy.minSimilarity;
        }
      }

      // Build an expanded query context from the last 3 messages to capture true semantic intent
      const recentMessages = chat.messages.slice(-3);
      const queryContext = recentMessages.map(m => `${m.role === 'user' ? 'User' : 'KI'}: ${m.content}`).join('\n');
      
      const qEmbed = await getEmbedding(queryContext, apiKey);
      const allMemories = getMemories();
      // Find top relevant memories using dynamic strategy
      recalledMemories = searchMemories(qEmbed, allMemories, topK, minSimilarity);
    } catch (err) {
      console.error("Vector search failed:", err.message);
    }
  }

  // Fetch Vogelperspektive context if requested
  let vogelData = null;
  if (useVogelperspektive === 'true') {
    vogelData = await getVogelperspektiveData();
  }

  // Compute shared context from other active chats ("One Brain")
  const rolesMap = getRoles();
  const otherChatsContext = chats
    .filter(c => c.id !== chatId && c.messages && c.messages.length > 0)
    .map(c => {
      const recent = c.messages.slice(-3).map(m => {
        let roleLabel = 'Bot';
        if (m.role === 'user') roleLabel = 'Nutzer';
        else if (c.role && rolesMap[c.role]) roleLabel = rolesMap[c.role].title;
        return `${roleLabel}: ${m.content}`;
      }).join('\n');
      const chatTitle = (c.role && rolesMap[c.role]) ? rolesMap[c.role].title : c.title;
      return `Chat (${chatTitle}):\n${recent}`;
    }).join('\n\n');

  // Build system instructions with preconfigured role + tone + long term memory + shared context
  let systemInstructionText = buildSystemInstruction(
    chat.role || 'standard',
    chat.tone || 'neutral',
    recalledMemories,
    otherChatsContext
  );

  if (vogelData) {
    systemInstructionText += buildVogelperspektiveInstruction(vogelData);
  }

  // Fetch web search results if toggle active (privacy-first via DuckDuckGo)
  let webSearchResults = null;
  let webSearchQuery = null;
  if (useWebSearch === 'true' && content) {
    try {
      // Build a concise search query from the user message
      webSearchQuery = content.length > 120 ? content.substring(0, 120) : content;
      res.write(`data: ${JSON.stringify({ info: `🌐 Web-Recherche läuft: "${webSearchQuery}"...` })}\n\n`);
      webSearchResults = await searchDuckDuckGo(webSearchQuery, 2);
      if (webSearchResults && webSearchResults.length > 0) {
        systemInstructionText += buildWebSearchInstruction(webSearchQuery, webSearchResults);
        res.write(`data: ${JSON.stringify({ webSearch: { query: webSearchQuery, results: webSearchResults.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })) } })}\n\n`);
      }
    } catch (err) {
      console.error('Web search failed:', err.message);
    }
  }

  // Send recalled memories and vogelData back to client immediately so they can render them
  res.write(`data: ${JSON.stringify({ recalledMemories, vogelData })}\n\n`);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    let modelName = chat.model || "gemini-2.5-pro";

    const roles = getRoles();
    const roleObj = roles[chat.role] || roles.standard;
    const roleTemp = roleObj ? roleObj.temperature : 0.7;

    let contextWindow = 30; // default to medium
    if (roleObj) {
      if (typeof roleObj.contextStrategy === 'number') {
        contextWindow = roleObj.contextStrategy;
      } else if (!isNaN(parseInt(roleObj.contextStrategy))) {
        contextWindow = parseInt(roleObj.contextStrategy);
      } else if (roleObj.contextStrategy === 'full') {
        const maxContext = parseInt(process.env.MAX_CONTEXT_WINDOW) || 100;
        contextWindow = maxContext;
      } else if (roleObj.contextStrategy === 'compact') {
        contextWindow = 10;
      }
    }

    // Fallback models map
    // Fallback models map for Gemini
    let fallbackModelName = modelName;

    let completeResponse = "";
    let promptTokenCount = 0;
    let candidatesTokenCount = 0;

    if (modelName.startsWith('gpt-') || modelName.startsWith('moonshot-')) {
      const streamRes = await handleOpenAIStream(modelName, chat, systemInstructionText, res, isAborted, contextWindow);
      completeResponse = streamRes.completeResponse;
      promptTokenCount = streamRes.promptTokens;
      candidatesTokenCount = streamRes.completionTokens;
    } else if (modelName.startsWith('claude-')) {
      const streamRes = await handleAnthropicStream(modelName, chat, systemInstructionText, res, isAborted, contextWindow);
      completeResponse = streamRes.completeResponse;
      promptTokenCount = streamRes.promptTokens;
      candidatesTokenCount = streamRes.completionTokens;
    } else {
      const sendWithRetry = async (chatInstance, payload, retries = 4, delay = 2000) => {
      for (let i = 0; i <= retries; i++) {
        try {
          return await chatInstance.sendMessageStream(payload);
        } catch (e) {
          if (i === retries) throw e;
          console.warn(`API call failed, retrying in ${delay}ms...`, e.message);
          res.write(`data: ${JSON.stringify({ info: `Modell überlastet. Nächster Versuch in ${delay/1000}s...` })}\n\n`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
        }
      }
    };

    const messagePayload = apiParts.length === 1 && apiParts[0].text ? apiParts[0].text : apiParts;

    let result;

    // Construct Gemini chat history structure (excluding the current turn)
    const history = [];
    let prevMessages = await contextEngine.buildContextForLLM(
      contextMethod || 'sliding_window',
      Object.assign({}, chat, {messages: chat.messages.slice(0, -1)}),
      content,
      contextWindow
    );
    
    // Merge consecutive messages of the same role to satisfy Gemini API requirements
    for (let i = 0; i < prevMessages.length; i++) {
      const msgRole = prevMessages[i].role === 'user' ? 'user' : 'model';
      const msgText = prevMessages[i].content || '';
      
      if (history.length > 0 && history[history.length - 1].role === msgRole) {
        history[history.length - 1].parts[0].text += '\n\n' + msgText;
      } else {
        history.push({
          role: msgRole,
          parts: [{ text: msgText }]
        });
      }
    }
    
    // Gemini API strictly requires history to start with 'user'
    while (history.length > 0 && history[0].role !== 'user') {
      history.shift();
    }

    let attemptCount = 0;
    const maxAttempts = 2;
    let geminiResult = null;

    while (attemptCount < maxAttempts) {
      attemptCount++;
      try {
        let currentModelName = (attemptCount === 1) ? modelName : fallbackModelName;
        
        if (attemptCount === 2) {
          console.info(`Automatische Ausweichung auf ${fallbackModelName}...`);
          chat.model = fallbackModelName;
          saveChats(chats);
          res.write(`data: ${JSON.stringify({ info: `Modell überlastet oder fehlgeschlagen. Wechsle automatisch zu ${fallbackModelName}...` })}\n\n`);
          res.write(`data: ${JSON.stringify({ modelUpdate: fallbackModelName })}\n\n`);
        }

        const model = genAI.getGenerativeModel({
          model: currentModelName,
          systemInstruction: systemInstructionText,
          tools: (useVogelperspektive === 'true' || useWebSearch === 'true') ? vogelTools : undefined,
          generationConfig: {
            temperature: roleTemp
          }
        });

        const geminiChat = model.startChat({ history: history });
        let currentPayload = messagePayload;
        let isFunctionTurn = false;

        // Send payload to model
        geminiResult = await sendWithRetry(geminiChat, currentPayload, (attemptCount === 1 ? 2 : 1), 2000);
        
        for await (const chunk of geminiResult.stream) {
          if (isAborted) {
            console.log("Client aborted generation stream.");
            break;
          }
          
          const calls = typeof chunk.functionCalls === 'function' ? chunk.functionCalls() : chunk.functionCalls;
          if (calls && calls.length > 0) {
            let pendingToolContexts = [];
            for (const call of calls) {
              if (call.name === 'searchTheWeb' && call.args && call.args.query) {
                res.write(`data: ${JSON.stringify({ info: `🌐 KI sucht im Web: "${call.args.query}"...` })}\n\n`);
                try {
                  const onTheFlyResults = await searchDuckDuckGo(call.args.query, typeof call.args.deepScrape === 'number' ? call.args.deepScrape : 2);
                  if (onTheFlyResults && onTheFlyResults.length > 0) {
                    if (!webSearchResults) webSearchResults = [];
                    webSearchResults.push(...onTheFlyResults);
                    webSearchQuery = call.args.query;
                    res.write(`data: ${JSON.stringify({ webSearch: { query: call.args.query, results: onTheFlyResults.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })) } })}\n\n`);
                    pendingToolContexts.push("System-Einschub: Deine Web-Suche hat folgende Ergebnisse geliefert:\n\n" + onTheFlyResults.map(r => `Quelle: ${r.title}\nInhalt: ${r.snippet}\n${r.content ? 'Volltext-Auszug: ' + r.content : ''}`).join("\n\n"));
                  }
                } catch (searchErr) {
                  console.error('On-the-fly web search failed:', searchErr.message);
                }

              } else if (call.name === 'saveToLongTermMemory' && call.args && call.args.content) {
                res.write(`data: ${JSON.stringify({ info: `💾 Speichere im Langzeitgedächtnis...` })}\n\n`);
                try {
                  const memText = call.args.tags ? `${call.args.content}\n[Tags: ${call.args.tags}]` : call.args.content;
                  const embedding = await getEmbedding(memText, apiKey);
                  const memories = getMemories();
                  memories.push({
                    id: uuidv4(),
                    text: memText,
                    embedding,
                    metadata: { source: call.args.source || 'Explizit gespeichert', timestamp: new Date().toISOString(), chatId: chat.id, explicit: true }
                  });
                  saveMemories(memories);
                  res.write(`data: ${JSON.stringify({ memorySaved: { content: call.args.content, source: call.args.source } })}\n\n`);
                  pendingToolContexts.push("System-Einschub: Deine Notiz wurde erfolgreich im Langzeitgedächtnis gespeichert.");
                } catch (memErr) {
                  console.error('Explicit memory save failed:', memErr.message);
                }
              } else {
                // Front-end handles manageTodo, manageAppointment, optimizeBehavior
                res.write(`data: ${JSON.stringify({ functionCall: call })}\n\n`);
                pendingToolContexts.push(`System-Einschub: Deine Aktion "${call.name}" wurde zur Ausführung/Bestätigung an das System übergeben.`);
              }
            }

            // Trigger a single second generation turn to let the AI finish its thought/answer
            if (pendingToolContexts.length > 0) {
              const combinedContext = pendingToolContexts.join("\n\n") + "\n\nSystem: Bitte antworte dem Nutzer nun GANZ NORMAL IM TEXT auf seine Frage. Erkläre ihm nicht, was du im Hintergrund gemacht hast, sondern liefere einfach die finale Antwort!";
              try {
                // Ensure alternating roles: push the current user payload, then a simulated model response containing the tool call, then the system result.
                const secondHistory = [...history];
                secondHistory.push({ role: 'user', parts: [{ text: (typeof currentPayload === 'string' ? currentPayload : JSON.stringify(currentPayload)) }] });
                secondHistory.push({ role: 'model', parts: [{ text: "Ich habe die Werkzeuge im Hintergrund ausgeführt." }] });
                
                // Create a text-only model to force a text response and prevent infinite tool loops
                const textOnlyModel = genAI.getGenerativeModel({
                  model: modelName,
                  systemInstruction: systemInstructionText,
                });
                const secondGeminiChat = textOnlyModel.startChat({ history: secondHistory });
                const secondResult = await sendWithRetry(secondGeminiChat, combinedContext, 1, 2000);
                for await (const chunk2 of secondResult.stream) {
                  if (isAborted) break;
                  try {
                    const text2 = chunk2.text();
                    if (text2) {
                      completeResponse += text2;
                      res.write(`data: ${JSON.stringify({ text: text2 })}\n\n`);
                    }
                  } catch (e) {}
                }
              } catch (secondTurnErr) {
                console.error("Failed second turn after tools:", secondTurnErr.message);
                const warnMsg = "\n\n*(Die Generierung der finalen Text-Antwort wurde durch Serverüberlastung oder einen Timeout bei Google Gemini abgebrochen. Die Hintergrundaktion wurde aber ausgeführt!)*";
                completeResponse += warnMsg;
                res.write(`data: ${JSON.stringify({ text: warnMsg })}\n\n`);
              }
            }
          }

          try {
            const text = chunk.text();
            if (text) {
              completeResponse += text;
              res.write(`data: ${JSON.stringify({ text })}\n\n`);
            }
          } catch (e) {}
        }

        break; // Successfully completed stream

      } catch (err) {
        if (attemptCount >= maxAttempts || completeResponse.length > 0) {
          if (completeResponse.length > 0) {
            const warnMsg = "\n\n*(Generierung wurde durch Serverüberlastung abgebrochen)*";
            completeResponse += warnMsg;
            res.write(`data: ${JSON.stringify({ text: warnMsg })}\n\n`);
            break; 
          } else {
            throw err;
          }
        }
      }
    }

    // Fetch API token usage metadata from Gemini if applicable
    try {
      if (geminiResult && geminiResult.response) {
        const response = await geminiResult.response;
        if (response.usageMetadata) {
          promptTokenCount = response.usageMetadata.promptTokenCount;
          candidatesTokenCount = response.usageMetadata.candidatesTokenCount;
        }
      }
    } catch (metaErr) {
      console.warn("Failed to retrieve response usage metadata:", metaErr.message);
    }
    } // End of Gemini else block

    // Append model response to local database
    const modelMsgId = uuidv4();
    const modelMessage = {
      id: modelMsgId,
      role: 'model',
      content: completeResponse,
      recalledMemories: recalledMemories,
      vogelData: vogelData,
      webSearch: webSearchResults ? { query: webSearchQuery, results: webSearchResults.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })) } : null,
      timestamp: new Date().toISOString()
    };

    // Reload chats to prevent race condition if a frontend tool was executed concurrently
    const freshChats = getChats();
    const freshChat = freshChats.find(c => c.id === chat.id);
    if (freshChat) {
      freshChat.messages.push(modelMessage);
      saveChats(freshChats);
      
      // Asynchrone Hintergrund-Updates für Kontext-Strategien
      (async () => {
        try {
          let updated = false;
          
          if (contextMethod === 'in_chat_rag') {
            const embUser = await getEmbedding(content, apiKey);
            const embModel = await getEmbedding(completeResponse, apiKey);
            
            const uMsg = freshChat.messages.find(m => m.timestamp === userMessage.timestamp);
            if (uMsg) uMsg.embedding = embUser;
            
            const mMsg = freshChat.messages.find(m => m.timestamp === modelMessage.timestamp);
            if (mMsg) mMsg.embedding = embModel;
            
            updated = true;
          }
          
          if (contextMethod === 'rolling_summary') {
            await contextEngine.updateRollingSummaryAsync(freshChat);
            updated = true;
          }
          
          if (updated) saveChats(freshChats);
        } catch (e) {
          console.error("Hintergrund-Update für Kontext fehlgeschlagen:", e);
        }
      })();
    }

    // Auto-learn/index current exchange if requested
    if (autoLearn === 'true' && content && content.length > 20 && completeResponse.length > 20) {
      (async () => {
        try {
          const memoryText = `Frage: ${content}\nAntwort: ${completeResponse}`;
          const embedding = await getEmbedding(memoryText, apiKey);
          const memories = getMemories();
          memories.push({
            id: uuidv4(),
            text: memoryText,
            embedding,
            metadata: {
              source: `Chat: ${chat.title}`,
              timestamp: new Date().toISOString(),
              chatId: chat.id
            }
          });
          saveMemories(memories);
          console.log("Automatically learned new chat interaction.");
        } catch (err) {
          console.error("Auto-learning embedding failed:", err.message);
        }
      })();
    }

    // Update cost tracking
    if (promptTokenCount || candidatesTokenCount) {
      console.log(`Token usage for ${chat.model}: Input=${promptTokenCount}, Output=${candidatesTokenCount}`);
      const updatedStats = updateCostStats(chat.model, promptTokenCount || 0, candidatesTokenCount || 0);
      res.write(`data: ${JSON.stringify({ totalCostUSD: updatedStats.totalCostUSD, monthlyCostUSD: updatedStats.monthlyCostUSD })}\n\n`);
    }

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err) {
    console.error("Error in Gemini API generation:", err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

async function handleOpenAIStream(modelName, chat, systemInstructionText, res, isAborted, contextWindow) {
  const apiKey = modelName.startsWith('moonshot-') ? process.env.MOONSHOT_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error(`${modelName.startsWith('moonshot-') ? 'Moonshot' : 'OpenAI'} API Key fehlt in der .env-Datei.`);
  
  const baseURL = modelName.startsWith('moonshot-') ? 'https://api.moonshot.cn/v1' : undefined;
  const openai = new OpenAI({ apiKey, baseURL });
  
  const messages = [{ role: 'system', content: systemInstructionText }];
  let prevMessages = chat.messages.slice(0, -1);
  if (prevMessages.length > contextWindow) prevMessages = prevMessages.slice(-contextWindow);
  
  prevMessages.forEach(m => {
    messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content });
  });
  
  const lastMsg = chat.messages[chat.messages.length - 1];
  messages.push({ role: 'user', content: lastMsg.content });
  
  let completeResponse = "";
  let promptTokens = 0;
  let completionTokens = 0;
  
  const stream = await openai.chat.completions.create({
    model: modelName,
    messages: messages,
    stream: true,
    stream_options: { include_usage: true }
  });
  
  for await (const chunk of stream) {
    if (isAborted) break;
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens;
      completionTokens = chunk.usage.completion_tokens;
    }
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) {
      completeResponse += content;
      res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
    }
  }
  return { completeResponse, promptTokens, completionTokens };
}

async function handleAnthropicStream(modelName, chat, systemInstructionText, res, isAborted, contextWindow) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Anthropic API Key fehlt in der .env-Datei.");
  
  const anthropic = new Anthropic({ apiKey });
  const messages = [];
  let prevMessages = chat.messages.slice(0, -1);
  if (prevMessages.length > contextWindow) prevMessages = prevMessages.slice(-contextWindow);
  
  let lastRole = null;
  prevMessages.forEach(m => {
    const role = m.role === 'user' ? 'user' : 'assistant';
    if (role === lastRole) {
      messages[messages.length - 1].content += "\n\n" + m.content;
    } else {
      messages.push({ role, content: m.content });
      lastRole = role;
    }
  });
  
  const lastMsg = chat.messages[chat.messages.length - 1];
  if (lastRole === 'user') {
    if (messages.length > 0) messages[messages.length - 1].content += "\n\n" + lastMsg.content;
    else messages.push({ role: 'user', content: lastMsg.content });
  } else {
    messages.push({ role: 'user', content: lastMsg.content });
  }
  
  let completeResponse = "";
  let promptTokens = 0;
  let completionTokens = 0;
  
  const stream = await anthropic.messages.create({
    model: modelName,
    system: systemInstructionText,
    max_tokens: 4096,
    messages: messages,
    stream: true
  });
  
  for await (const chunk of stream) {
    if (isAborted) break;
    if (chunk.type === 'message_start' && chunk.message.usage) {
      promptTokens = chunk.message.usage.input_tokens;
    } else if (chunk.type === 'message_delta' && chunk.usage) {
      completionTokens = chunk.message.usage.output_tokens;
    } else if (chunk.type === 'content_block_delta' && chunk.delta.text) {
      completeResponse += chunk.delta.text;
      res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
    }
  }
  return { completeResponse, promptTokens, completionTokens };
}

// Endpoint to export Markdown to DocX using Pandoc
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const os = require('os');

app.post('/api/export/docx', express.json(), async (req, res) => {
  const { content, chatId } = req.body;
  if (!content) return res.status(400).json({ error: "Missing content" });

  try {
    let referenceDocPath = null;
    
    // Find the latest docx file in the chat
    if (chatId) {
      const chats = getChats();
      const chat = chats.find(c => c.id === chatId);
      if (chat && chat.messages) {
        // Iterate backwards
        for (let i = chat.messages.length - 1; i >= 0; i--) {
          const msg = chat.messages[i];
          if (msg.files) {
            const docxFile = msg.files.find(f => f.name && f.name.toLowerCase().endsWith('.docx'));
            if (docxFile) {
              referenceDocPath = path.join(__dirname, 'data', docxFile.path);
              break;
            }
          }
        }
      }
    }

    const tmpMdPath = path.join(os.tmpdir(), `export_${Date.now()}.md`);
    const tmpDocxPath = path.join(os.tmpdir(), `export_${Date.now()}.docx`);
    fs.writeFileSync(tmpMdPath, content, 'utf8');

    let pandocCmd = `pandoc "${tmpMdPath}" -o "${tmpDocxPath}" --toc`;
    if (referenceDocPath && fs.existsSync(referenceDocPath)) {
      pandocCmd += ` --reference-doc="${referenceDocPath}"`;
    }

    await execPromise(pandocCmd);

    res.download(tmpDocxPath, 'BrainExtender_Export.docx', (err) => {
      // Cleanup
      if (fs.existsSync(tmpMdPath)) fs.unlinkSync(tmpMdPath);
      if (fs.existsSync(tmpDocxPath)) fs.unlinkSync(tmpDocxPath);
    });

  } catch (error) {
    console.error("Export error:", error);
    res.status(500).json({ error: "Fehler beim Exportieren des Dokuments." });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`BrainExtender server running at http://localhost:${PORT}`);
  console.log(`==================================================`);
  initProtokollant();
});

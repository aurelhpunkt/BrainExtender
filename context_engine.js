const { v4: uuidv4 } = require('uuid');

/**
 * Builds the context based on the selected method.
 * @param {string} method - 'sliding_window', 'rolling_summary', 'in_chat_rag', 'distillation'
 * @param {object} chat - The chat object
 * @param {string} currentMessage - The current user message
 * @param {number} contextWindow - Maximum messages to include for sliding window
 * @returns {Promise<Array>} The filtered messages array
 */
async function buildContextForLLM(method, chat, currentMessage, contextWindow) {
  if (!chat.messages || chat.messages.length === 0) return [];

  // Always keep the last 3 messages as immediate context
  const immediateContext = chat.messages.slice(-3);
  let oldMessages = chat.messages.slice(0, -3);

  if (oldMessages.length === 0) {
    return immediateContext; // Chat is too short for advanced context
  }

  if (method === 'rolling_summary' && chat.rollingSummary) {
    // Add the rolling summary as a system context block at the beginning
    const summaryMsg = {
      role: 'user',
      content: `[SYSTEM-INTERN: Bisherige Chat-Zusammenfassung]:\n${chat.rollingSummary}`
    };
    return [summaryMsg, ...immediateContext];
  }

  if (method === 'distillation') {
    // Distill older messages using local Llama 3
    const distilled = await distillContext(oldMessages, currentMessage);
    if (distilled) {
      const summaryMsg = {
        role: 'user',
        content: `[SYSTEM-INTERN: Relevante destillierte Fakten aus dem alten Chatverlauf für die aktuelle Frage]:\n${distilled}`
      };
      return [summaryMsg, ...immediateContext];
    }
  }

  // Fallback: Sliding Window
  return chat.messages.slice(-contextWindow);
}

/**
 * Updates the rolling summary asynchronously using local Llama 3
 */
async function updateRollingSummaryAsync(chat) {
  try {
    const unsummarized = chat.messages.filter(m => !m.summarized);
    if (unsummarized.length < 3) return chat;

    let newText = "";
    unsummarized.forEach(m => {
      newText += `[${m.role.toUpperCase()}]: ${m.text || m.content}\n`;
      m.summarized = true; // Mark as summarized
    });

    const prompt = `Du bist ein Protokollant. Aktualisiere die fortlaufende Zusammenfassung dieses Chats basierend auf den neuesten Nachrichten. Behalte alle wichtigen Fakten aus der alten Zusammenfassung, füge die neuen Erkenntnisse hinzu und streiche unwichtiges. Fasse dich kurz (max 300 Wörter).

ALTE ZUSAMMENFASSUNG:
${chat.rollingSummary || "Keine bisherige Zusammenfassung vorhanden."}

NEUE NACHRICHTEN:
${newText}

NEUE ZUSAMMENFASSUNG:`;

    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3:latest",
        prompt: prompt,
        stream: false
      })
    });

    if (response.ok) {
      const data = await response.json();
      chat.rollingSummary = data.response;
    }
  } catch (err) {
    console.error("Failed to update rolling summary:", err.message);
  }
  return chat;
}

/**
 * Distill context for a specific query
 */
async function distillContext(messages, currentQuery) {
  try {
    let history = messages.map(m => `[${m.role.toUpperCase()}]: ${m.text || m.content}`).join('\n');
    const prompt = `Lies den folgenden Chatverlauf. Welche Informationen daraus sind hochrelevant für die Beantwortung der neuen Nutzerfrage? Ignoriere alles Irrelevante. Fasse die relevanten Fakten kompakt in Stichpunkten zusammen.

CHATVERLAUF:
${history}

NEUE NUTZERFRAGE:
${currentQuery}

RELEVANTE FAKTEN:`;

    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3:latest",
        prompt: prompt,
        stream: false
      })
    });

    if (response.ok) {
      const data = await response.json();
      return data.response;
    }
  } catch (err) {
    console.error("Failed to distill context:", err.message);
  }
  return null;
}

module.exports = {
  buildContextForLLM,
  updateRollingSummaryAsync,
  distillContext
};

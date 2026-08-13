const fs = require('fs');

try {
    const rawChats = fs.readFileSync('/Users/aurelhullenhagen/Development/BrainExtender/data/chats.json', 'utf8');
    const chats = JSON.parse(rawChats);

    // Find the chat session for the Beziehungs-Coach. 
    // It might be a specific chat ID, or we can look for messages where agentId contains 'coach'
    let coachMessages = [];
    
    // In BrainExtender, chats might be an array of message objects, or an object keyed by chatId
    if (Array.isArray(chats)) {
        coachMessages = chats.filter(m => m.agentId && m.agentId.toLowerCase().includes('coach'));
    } else {
        // object keyed by chatId
        for (const chatId in chats) {
            const chatObj = chats[chatId];
            const messages = Array.isArray(chatObj) ? chatObj : (chatObj.messages || []);
            
            // Just check if any message in this thread has a coach agentId, or if the thread itself is for the coach
            if (messages.some(m => m.agentId && m.agentId.toLowerCase().includes('coach') || m.role === 'coach')) {
                 coachMessages = coachMessages.concat(messages);
            }
        }
        
        // If we didn't find any by agentId, maybe we can just grep the whole thing or look at recent messages overall
        if (coachMessages.length === 0) {
             for (const chatId in chats) {
                const chatObj = chats[chatId];
                const messages = Array.isArray(chatObj) ? chatObj : (chatObj.messages || []);
                coachMessages = coachMessages.concat(messages);
             }
             // Filter by content containing 'Beziehungs-Coach' just in case
             coachMessages = coachMessages.filter(m => JSON.stringify(m).toLowerCase().includes('coach'));
        }
    }

    // Sort by timestamp if available
    coachMessages.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

    // Get the last 20 messages
    const last20 = coachMessages.slice(-20);

    let output = "LAST 20 MESSAGES FOR COACH:\n\n";
    last20.forEach((m, idx) => {
        output += `[${idx+1}] Time: ${m.timestamp}\nRole: ${m.role || m.sender}\nAgent: ${m.agentId}\nContent: ${m.content}\n\n`;
    });

    fs.writeFileSync('/Users/aurelhullenhagen/Development/BrainExtender/scratch/coach_chat.txt', output);
    console.log("Extraction complete. Wrote to scratch/coach_chat.txt");
    
} catch (e) {
    console.error("Error:", e);
}

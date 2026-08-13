const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/Users/aurelhullenhagen/Development/BrainExtender/data/chats.json', 'utf8'));

const chatList = data.chats || [];
const coachChat = chatList.find(c => c.role === 'beziehung');

if (coachChat && coachChat.messages) {
    const msgs = coachChat.messages.slice(-20);
    let out = "--- Beziehungs-Coach Chat (Letzte 20) ---\n\n";
    msgs.forEach(m => {
        out += `[${m.timestamp}] ${m.role.toUpperCase()}:\n${m.content}\n\n`;
    });
    fs.writeFileSync('/Users/aurelhullenhagen/Development/BrainExtender/scratch/coach_chat.txt', out);
    console.log("Success");
} else {
    console.log("Coach chat not found!");
}

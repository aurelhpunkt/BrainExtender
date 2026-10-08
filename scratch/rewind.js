const fs = require('fs');
const path = '/Users/aurelhullenhagen/Development/BrainExtender/data/chats.json';

try {
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  const chatList = data.chats || [];
  
  const coachChat = chatList.find(c => c.role === 'beziehung');
  
  if (coachChat) {
    const originalLength = coachChat.messages.length;
    // Filter out all messages from today (2026-08-13)
    coachChat.messages = coachChat.messages.filter(m => !m.timestamp.startsWith('2026-08-13'));
    const newLength = coachChat.messages.length;
    
    fs.writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Success! Rewound coach chat. Removed ${originalLength - newLength} messages from today.`);
  } else {
    console.log("Coach chat not found.");
  }
} catch (e) {
  console.error("Error:", e);
}

const fs = require('fs');
const path = require('path');

const chatsData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'chats.json'), 'utf8'));

chatsData.chats.forEach(c => {
  if (c.rolling_summary && c.rolling_summary.includes('BÄM')) {
    console.log(`Chat '${c.title}' rolling_summary contains BÄM.`);
  }
  if (c.systemInstruction && c.systemInstruction.includes('BÄM')) {
    console.log(`Chat '${c.title}' systemInstruction contains BÄM.`);
  }
  if (c.rolling_summary && c.rolling_summary.toLowerCase().includes('coach')) {
    console.log(`Chat '${c.title}' rolling_summary contains 'coach'.`);
  }
});
console.log("Check complete.");

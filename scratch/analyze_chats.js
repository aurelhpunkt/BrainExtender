const fs = require('fs');

const dataDir = '/Users/aurelhullenhagen/Development/BrainExtender/data';
const chats = JSON.parse(fs.readFileSync(`${dataDir}/chats.json`, 'utf8'));

let stats = {
  june: { msgs: 0, totalLength: 0, costEstimate: 0 },
  july: { msgs: 0, totalLength: 0, costEstimate: 0 }
};

for (const chat of chats.chats) {
  for (const msg of chat.messages) {
    if (!msg.timestamp) continue;
    
    const date = new Date(msg.timestamp);
    const month = date.getMonth() + 1; // 6 = June, 7 = July
    const textLength = (msg.content || '').length;
    
    if (month === 6) {
      stats.june.msgs++;
      stats.june.totalLength += textLength;
    } else if (month === 7) {
      stats.july.msgs++;
      stats.july.totalLength += textLength;
    }
  }
}

console.log("June stats:", {
  msgs: stats.june.msgs,
  avgLength: Math.round(stats.june.totalLength / stats.june.msgs)
});

console.log("July stats:", {
  msgs: stats.july.msgs,
  avgLength: Math.round(stats.july.totalLength / stats.july.msgs)
});

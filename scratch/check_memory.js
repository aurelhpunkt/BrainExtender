const fs = require('fs');
const path = require('path');

const memPath = path.join(__dirname, '..', 'data', 'memory.json');
if (fs.existsSync(memPath)) {
  const memData = JSON.parse(fs.readFileSync(memPath, 'utf8'));
  let modifiedCount = 0;
  memData.vectors.forEach(m => {
    if (m.text && m.text.includes('BÄM')) {
      m.text = m.text.replace(/BÄM\.?/g, '').trim();
      modifiedCount++;
    }
  });
  if (modifiedCount > 0) {
    fs.writeFileSync(memPath, JSON.stringify(memData, null, 2));
    console.log(`Removed BÄM from ${modifiedCount} memories.`);
  } else {
    console.log("No BÄM found.");
  }
} else {
  console.log("memory.json not found.");
}

const fs = require('fs');
const path = require('path');

const statsPath = path.join('/Users/aurelhullenhagen/Development/BrainExtender', 'data', 'stats.json');
if (fs.existsSync(statsPath)) {
  const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
  
  // Total cost according to AI studio: 
  // June: 107.87 EUR
  // July: 119.14 EUR
  // Total: 227.01 EUR (approx 245 USD)
  stats.totalCostUSD = 245.50; 
  stats.monthlyCostUSD = 129.50; // Approx 119.14 EUR
  
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
  console.log("Updated stats.json totalCostUSD to", stats.totalCostUSD);
} else {
  console.log("stats.json not found");
}

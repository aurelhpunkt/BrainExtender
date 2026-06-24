const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const zip = new AdmZip();

// Create _chat.txt content
const chatContent = `[05.06.26, 14:30:00] Alice: Hallo Bob!
[05.06.26, 14:31:00] Bob: Hey Alice! Alles gut bei dir?
[05.06.26, 14:32:00] Alice: Ja, ich habe gerade ein Bild von einer Katze gezeichnet.
[05.06.26, 14:32:30] Alice: <Medien weggelassen>
[05.06.26, 14:33:00] Bob: Oh super, zeig mal!
[05.06.26, 14:34:00] Alice: Hier ist es! Siehst du das Bild?
[05.06.26, 14:35:00] Bob: Wow, das sieht wirklich süß aus.
[05.06.26, 14:36:00] Alice: Danke! Lass uns morgen treffen.
[05.06.26, 14:37:00] Bob: Gerne, um 15 Uhr?
[05.06.26, 14:38:00] Alice: Ja, passt perfekt! Bis morgen!
`;

zip.addFile('_chat.txt', Buffer.from(chatContent, 'utf8'));

// Add the image
const imagePath = '/Users/aurelhullenhagen/.gemini/antigravity-ide/brain/11a0fa27-0466-4558-a272-b173b03484f8/whatsapp_test_image_1780738066035.png';
if (fs.existsSync(imagePath)) {
  zip.addLocalFile(imagePath, '', 'cat_image.png');
  console.log('Added image to zip.');
} else {
  console.error('Image path not found:', imagePath);
}

const outputPath = path.join(__dirname, 'whatsapp_chat_test.zip');
zip.writeZip(outputPath);
console.log('Successfully wrote ZIP to', outputPath);

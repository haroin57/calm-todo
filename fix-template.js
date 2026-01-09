const fs = require('fs');
let content = fs.readFileSync('src/lib/openai.ts', 'utf8');
content = content.replace('${"$"}{taskTitle}', '${taskTitle}');
fs.writeFileSync('src/lib/openai.ts', content);
console.log('Fixed!');

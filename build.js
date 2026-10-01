import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('public',{recursive:true});
for(const file of ['index.html','teams.js','community.js'])await copyFile(file,`public/${file}`);

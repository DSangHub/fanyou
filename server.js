import http from 'node:http';
import {readFile} from 'node:fs/promises';
import handler from './api/index.js';
const assets={'/':'index.html','/index.html':'index.html','/teams.js':'teams.js','/community.js':'community.js'};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8'};
http.createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname.startsWith('/api/'))return handler(req,res);
 if(!assets[pathname]){res.statusCode=404;res.end('Not found');return;}
 try{res.setHeader('Content-Type',types[pathname.endsWith('.js')?'.js':'.html']);res.end(await readFile(new URL(assets[pathname],import.meta.url)));}catch{res.statusCode=500;res.end('Unavailable');}
}).listen(Number(process.env.PORT)||3000,()=>console.log('Fanyou listening on localhost'));

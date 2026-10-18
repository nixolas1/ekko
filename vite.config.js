import {defineConfig,loadEnv} from 'vite';
import {wgslValidationPlugin} from './scripts/lint-wgsl.mjs';
import {createRemixHandler} from './server/remix-handler.js';
const rewrite=(req,_res,next)=>{if(/^\/remix(?:\/|$)/.test(req.url)&&!req.url.split('?')[0].endsWith('.html'))req.url='/remix/index.html';next();};
export default defineConfig(({mode})=>{
 Object.assign(process.env,Object.fromEntries(Object.entries(loadEnv(mode,process.cwd(),'')).filter(([key])=>key==='DATABASE_URL')));
 const api=createRemixHandler();
 return {
  plugins:[wgslValidationPlugin(),{name:'remix-routes',configureServer(server){server.middlewares.use('/api/remixes',(req,res)=>{req.url='/api/remixes'+req.url;return api(req,res);});server.middlewares.use(rewrite);},configurePreviewServer(server){server.middlewares.use('/api/remixes',(req,res)=>{req.url='/api/remixes'+req.url;return api(req,res);});server.middlewares.use(rewrite);}}],
  server:{proxy:{'/api/youtube':'http://127.0.0.1:8765'}},
  build:{rollupOptions:{input:{main:'index.html',remix:'remix/index.html',preview:'remix/preview.html'}}},
 };
});

import {defineConfig} from 'vite';
export default defineConfig({server:{proxy:{'/api/youtube':'http://127.0.0.1:8765'}}});

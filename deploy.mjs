// deploy.mjs — 빌드 후 Vercel 자동 배포
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import path from 'path';

const VERCEL = 'C:\\Users\\abcd\\AppData\\Roaming\\npm\\vercel.cmd';

function run(cmd) {
  execSync(cmd, { stdio: 'inherit', shell: 'cmd.exe' });
}

const root = process.cwd();
const dist = path.join(root, 'dist');
// 루트에 .vercel/output 생성 (빌드해도 삭제 안됨)
const output = path.join(root, '.vercel', 'output');
const staticDir = path.join(output, 'static');

console.log('🔨 빌드 중...');
run('npm run build');

console.log('📦 배포 파일 준비 중...');
rmSync(staticDir, { recursive: true, force: true });
mkdirSync(staticDir, { recursive: true });
writeFileSync(path.join(output, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { handle: 'filesystem' },
    { src: '/(.*)', dest: '/index.html' }
  ]
}, null, 2));

run(`xcopy /E /I /Y "${path.join(dist, 'assets')}" "${path.join(staticDir, 'assets')}"`);
run(`copy /Y "${path.join(dist, 'index.html')}" "${staticDir}"`);
if (existsSync(path.join(dist, 'style-previews'))) {
  run(`xcopy /E /I /Y "${path.join(dist, 'style-previews')}" "${path.join(staticDir, 'style-previews')}"`);
}

console.log('🚀 Vercel 배포 중...');
run(`"${VERCEL}" --prebuilt --prod`);
console.log('✅ 배포 완료!');

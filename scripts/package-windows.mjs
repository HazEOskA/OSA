import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
if (process.platform !== 'win32') throw Error('Pakiet Windows budujemy i sprawdzamy na Windows.');
const root = resolve('.');
const target = resolve(root, 'osa-dashboard-windows');
if (!target.startsWith(root + '\\')) throw Error('Nieprawidłowy katalog pakietu.');
try { await access(target); throw Error('Katalog pakietu już istnieje; nie nadpisano go.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
await mkdir(join(target, 'runtime'), { recursive: true });
await mkdir(join(target, 'scripts'), { recursive: true });
await cp('dist', join(target, 'dist'), { recursive: true });
await cp('node_modules', join(target, 'node_modules'), { recursive: true });
await cp('package.json', join(target, 'package.json'));
await cp('Uruchom-OSA.cmd', join(target, 'Uruchom-OSA.cmd'));
for (const file of ['setup.mjs', 'launch-dashboard.mjs']) await cp(join('scripts', file), join(target, 'scripts', file));
await cp(process.execPath, join(target, 'runtime/node.exe'));
await cp(join(dirname(process.execPath), 'LICENSE'), join(target, 'runtime/LICENSE'));
await writeFile(join(target, 'ZACZNIJ-TUTAJ.txt'), 'OSA — TWÓJ OSOBISTY DASHBOARD\r\n\r\n1. Wypakuj cały folder w wybranym miejscu.\r\n2. Kliknij dwukrotnie Uruchom-OSA.cmd.\r\n3. Przeglądarka otworzy Twój prywatny dashboard.\r\n\r\nNode.js jest w folderze runtime. Dane i prywatny token powstaną lokalnie w folderze data. Zachowaj ten folder przy przenoszeniu aplikacji; nie publikuj data ani .env.\r\n\r\nOrganizer, Prompt God, raporty i kontrola składni działają bez klucza modelu. Narzędzia generatywne wymagają skonfigurowanego modelu. Raport wieczorny działa, gdy proces OSA jest uruchomiony.\r\n\r\nKod źródłowy: https://github.com/HazEOskA/OSA\r\n', 'utf8');
for (const path of ['.env','data','qa','.git']) {
  try { await access(join(target,path)); throw Error('Pakiet zawiera dane lokalne: ' + path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
console.log('Windows package prepared: ' + target);

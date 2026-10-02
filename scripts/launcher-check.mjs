import { cp, mkdtemp, readFile, access, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { resolve, join, sep } from 'node:path';
const run = promisify(execFile);
const qa = resolve('qa');
const temp = await mkdtemp(join(qa,'portable-check-'));
assert.ok(temp.startsWith(qa + sep));
try {
  await cp('osa-dashboard-windows',temp,{ recursive:true });
  const executable = join(temp,'runtime/node.exe');
  for(let i=0;i<2;i++) {
    const result = await run(executable,[join(temp,'scripts/launch-dashboard.mjs'),'--check'],{cwd:temp,windowsHide:true,timeout:45000});
    assert.match(result.stdout,/OSA_LAUNCHER_PASS/);
    const data = JSON.parse(result.stdout.match(/OSA_LAUNCHER_PASS (.+)/)[1]);
    assert.equal(data.privateNamespace,true); assert.equal(data.reports,true); assert.equal(data.staticUi,true);
  }
  const config = await readFile(join(temp,'.env'),'utf8');
  assert.match(config,/OSA_AI_PROVIDER=disabled/);
  await assert.rejects(access(resolve('osa-dashboard-windows','.env')));
  await assert.rejects(access(resolve('osa-dashboard-windows','data')));
  console.log('Windows launcher PASS: packaged runtime, first start, private authenticated API, static UI, clean restart and no credentials in distributable.');
} finally { await rm(temp,{recursive:true,force:true}); }

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const seedDir = 'seeds';
const files = fs.readdirSync(seedDir)
    .filter(f => f.startsWith('seed_part_') && f.endsWith('.sql'))
    .sort((a, b) => {
        const numA = parseInt(a.match(/(\d+)/)[0]);
        const numB = parseInt(b.match(/(\d+)/)[0]);
        return numA - numB;
    });

const args = process.argv.slice(2);
const isRemote = args.includes('--remote');
const flag = isRemote ? '--remote' : '--local';

console.log(`Found ${files.length} seed files.`);
console.log(`Target: ${isRemote ? 'REMOTE' : 'LOCAL'} database`);

for (const file of files) {
    console.log(`Executing ${file}...`);
    try {
        execSync(`npx wrangler d1 execute shopwice-db ${flag} --yes --file=${path.join(seedDir, file)}`, { stdio: 'inherit' });
    } catch (e) {
        console.error(`Failed to execute ${file}:`, e.message);
        process.exit(1);
    }
}

console.log('All seeds executed successfully!');

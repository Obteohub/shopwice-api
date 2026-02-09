const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const products = require('../products.json');

const R2_BUCKET = 'shopwice-media';
const R2_PUBLIC_URL = 'https://pub-3da318373ea74e3289271edc63013603.r2.dev';
const TEMP_DIR = path.join(__dirname, '../temp_images');
const SQL_FILE = path.join(__dirname, '../seed_media.sql');
const CONCURRENCY = 5;
const LIMIT = process.argv.includes('--all') ? Infinity : 20;

// Ensure temp dir exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

// Extract all unique images
const imagesMap = new Map();
products.forEach(p => {
    if (p.images && Array.isArray(p.images)) {
        p.images.forEach(img => {
            if (img.id && img.src && !imagesMap.has(img.id)) {
                imagesMap.set(img.id, img);
            }
        });
    }
});

const images = Array.from(imagesMap.values());
console.log(`Found ${images.length} unique images to migrate.`);

// Write SQL header
fs.writeFileSync(SQL_FILE, `-- Seed Media (Attachments)\n`);

const downloadImage = (url, filepath) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filepath);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download ${url}: Status ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(filepath, () => {});
            reject(err);
        });
    });
};

const uploadToR2 = (filepath, key) => {
    return new Promise((resolve, reject) => {
        // Use wrangler r2 object put
        // Note: Using --file
        const cmd = `npx wrangler r2 object put ${R2_BUCKET}/${key} --file "${filepath}"`;
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
};

const processImage = async (img) => {
    const filename = path.basename(img.src).split('?')[0]; // Remove query params
    const key = `images/${img.id}_${filename}`;
    const localPath = path.join(TEMP_DIR, `${img.id}_${filename}`);
    const publicUrl = `${R2_PUBLIC_URL}/${key}`;

    try {
        // 1. Download
        // console.log(`Downloading ${img.id}...`);
        await downloadImage(img.src, localPath);

        // 2. Upload
        // console.log(`Uploading ${img.id} to R2...`);
        await uploadToR2(localPath, key);

        // 3. Generate SQL
        const sql = `
INSERT INTO wp_posts (
    ID, post_author, post_date, post_date_gmt, post_content, post_title, 
    post_excerpt, post_status, comment_status, ping_status, post_name, 
    post_modified, post_modified_gmt, post_parent, guid, post_type, post_mime_type
) VALUES (
    ${img.id}, 
    1, 
    '${img.date_created.replace('T', ' ')}', 
    '${img.date_created_gmt.replace('T', ' ')}', 
    '', 
    '${(img.name || '').replace(/'/g, "''")}', 
    '', 
    'inherit', 
    'open', 
    'closed', 
    '${(img.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}', 
    '${img.date_modified.replace('T', ' ')}', 
    '${img.date_modified_gmt.replace('T', ' ')}', 
    0, 
    '${publicUrl}', 
    'attachment', 
    'image/jpeg'
) ON CONFLICT(ID) DO UPDATE SET guid = excluded.guid;
`;
        fs.appendFileSync(SQL_FILE, sql);
        
        // Also insert _wp_attached_file meta
        const metaSql = `
DELETE FROM wp_postmeta WHERE post_id = ${img.id} AND meta_key = '_wp_attached_file';
INSERT INTO wp_postmeta (post_id, meta_key, meta_value) 
VALUES (${img.id}, '_wp_attached_file', '${key}');
`;
        fs.appendFileSync(SQL_FILE, metaSql);

        // Cleanup
        fs.unlinkSync(localPath);
        process.stdout.write('.');
        return true;
    } catch (error) {
        console.error(`\nFailed to process image ${img.id}: ${error.message}`);
        // If download fails, we might still want to insert the post but with original URL? 
        // No, let's skip or log.
        return false;
    }
};

const main = async () => {
    const imagesToProcess = images.slice(0, LIMIT);
    console.log(`Starting migration of ${imagesToProcess.length} images (Limit: ${LIMIT})...`);
    
    // Process in batches
    for (let i = 0; i < imagesToProcess.length; i += CONCURRENCY) {
        const batch = imagesToProcess.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(img => processImage(img)));
        console.log(`\nProcessed ${Math.min(i + CONCURRENCY, imagesToProcess.length)}/${imagesToProcess.length}`);
    }

    console.log(`\nMigration script complete. SQL written to ${SQL_FILE}`);
    console.log(`Run: npx wrangler d1 execute shopwice-db --remote --file seed_media.sql`);
};

main();

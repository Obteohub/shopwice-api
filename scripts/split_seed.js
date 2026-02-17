const fs = require('fs');
const path = require('path');

const inputFile = 'seed_full.sql';
const outputDir = 'seeds';
const statementsPerFile = 500;

if (fs.existsSync(outputDir)){
    // Clean up
    fs.readdirSync(outputDir).forEach(f => fs.unlinkSync(path.join(outputDir, f)));
} else {
    fs.mkdirSync(outputDir);
}

console.log("Reading file...");
const content = fs.readFileSync(inputFile, 'utf8');

// We look for the start of SQL statements.
// They all start with "INSERT OR REPLACE INTO" at the beginning of a line (after \n).
// The first line might not have \n before it.

const delimiter = "\nINSERT OR REPLACE INTO ";
const parts = content.split(delimiter);

// The first part is "PRAGMA ... \nINSERT ..." or just "INSERT ..."
// Actually split removes the delimiter.
// part[0] is the first statement (or header + first statement part)
// part[1] is the rest of the 2nd statement, etc.
// We need to prepend "INSERT OR REPLACE INTO " to parts [1..n]
// And we need to be careful about part[0].

// Let's refine.
// We can construct the statements array.
const statements = [];

// Handle first part
if (parts.length > 0) {
    statements.push(parts[0]);
}

// Handle subsequent parts
for (let i = 1; i < parts.length; i++) {
    statements.push("INSERT OR REPLACE INTO " + parts[i]);
}

console.log(`Found ${statements.length} SQL statements.`);

let currentFileIndex = 1;
let currentChunk = [];
const header = "PRAGMA defer_foreign_keys = ON;\n";

// Special handling for the very first statement which might contain the PRAGMA or comments
// If statements[0] contains newlines and PRAGMA, we should preserve it.
// My generated file starts with PRAGMA... then \nINSERT...
// So split(delimiter) works:
// part[0] = "PRAGMA ... ;" (because the first INSERT was split away? No.)
// If file is:
// PRAGMA...;
// INSERT ...;
// INSERT ...;
// Then delimiter "\nINSERT OR REPLACE INTO " matches the newline before the 2nd INSERT?
// Or the first?
// "PRAGMA...;\nINSERT OR REPLACE INTO ..." -> split -> ["PRAGMA...;", "..."]
// So part[0] is the PRAGMA line(s).
// part[1] is the body of the first INSERT.
// So we need to prepend "INSERT OR REPLACE INTO " to part[1] too?
// Wait.
// "PRAGMA...;\nINSERT OR REPLACE INTO table..."
// Split by "\nINSERT OR REPLACE INTO "
// Result: ["PRAGMA...;", "table..."]
// So yes, we need to prepend to ALL parts except part[0] IF part[0] doesn't start with INSERT.
// BUT, what if the first line IS "INSERT..."?
// Then part[0] is empty or the first statement body?
// If file starts with "INSERT...", delimiter "\nINSERT..." won't match the start.
// So part[0] is the first statement.
// Then part[1] starts with the NEXT insert.

// Let's verify seed_full.sql content start.
// It usually starts with comments or PRAGMA.
// Let's assume the standard header I generated:
// "PRAGMA defer_foreign_keys = ON;\n"
// followed by "INSERT OR REPLACE INTO ..."

// So:
// part[0] = "PRAGMA defer_foreign_keys = ON;"
// part[1] = "wp_terms ... ;" (the rest of the first insert)
// part[2] = "wp_term_taxonomy ... ;"

// So correct logic:
// parts[0] is header (plus maybe other stuff).
// parts[1..n] need the prefix.

// Note: The delimiter matches "\nINSERT OR REPLACE INTO ".
// So the PREVIOUS statement's semicolon is at the end of part[k-1]?
// No, the delimiter consumes the newline BEFORE the INSERT.
// So the previous statement ended with `;`.
// The split removes `\nINSERT OR REPLACE INTO `.
// So part[0] ends with `;` (from the PRAGMA line).
// part[1] ends with `;` (end of 1st insert).
// So yes, we just need to prepend the prefix to parts 1..n.

// Wait, check if parts[0] is just header or actual data.
// If it's just header, we can put it in every file? No, just once?
// We want valid SQL files.
// We will add `PRAGMA ...` to every file anyway.
// So we can ignore part[0] if it's just the original PRAGMA.
// But maybe part[0] contains some INSERTs if the pattern didn't match?
// No, if it didn't match, it's all in part[0].
// Assuming valid matches.

// Let's filter out part[0] if it's just PRAGMA/comments.
const cleanStatements = [];

// Check part[0]
if (parts[0].trim().startsWith('INSERT')) {
    cleanStatements.push(parts[0]);
} else {
    // It's header. Ignore it (we add our own header).
    // Unless it contains "INSERT" somewhere inside?
    // Unlikely given the split.
}

for (let i = 1; i < parts.length; i++) {
    cleanStatements.push("INSERT OR REPLACE INTO " + parts[i]);
}

console.log(`Cleaned ${cleanStatements.length} statements.`);

for (let i = 0; i < cleanStatements.length; i++) {
    currentChunk.push(cleanStatements[i]);
    
    if (currentChunk.length >= statementsPerFile) {
        const outputContent = header + currentChunk.join('\n');
        const outputPath = path.join(outputDir, `seed_part_${currentFileIndex}.sql`);
        fs.writeFileSync(outputPath, outputContent);
        console.log(`Created ${outputPath} (${currentChunk.length} statements)`);
        currentFileIndex++;
        currentChunk = [];
    }
}

if (currentChunk.length > 0) {
    const outputContent = header + currentChunk.join('\n');
    const outputPath = path.join(outputDir, `seed_part_${currentFileIndex}.sql`);
    fs.writeFileSync(outputPath, outputContent);
    console.log(`Created ${outputPath} (${currentChunk.length} statements)`);
}

console.log(`Done. Created ${currentFileIndex} files.`);

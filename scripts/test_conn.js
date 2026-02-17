const https = require('https');

const url = 'https://shopwice.com';
console.log(`Fetching ${url}...`);

https.get(url, (res) => {
  console.log('statusCode:', res.statusCode);
  console.log('headers:', res.headers);
  res.on('data', (d) => {
    process.stdout.write(d);
  });
}).on('error', (e) => {
  console.error(e);
});

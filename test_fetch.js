const http = require('http');
http.get('http://localhost:3001/api/portfolio/yeri-default', (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => console.log(JSON.stringify(JSON.parse(data), null, 2)));
});

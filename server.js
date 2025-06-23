// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname))); // 静态托管 index.html, js/, models/, descriptors.json

// 接收前端推送，自动写 descriptors.json
app.post('/api/saveDescriptors', (req, res) => {
  const file = path.join(__dirname, 'descriptors.json');
  fs.writeFile(file, JSON.stringify(req.body, null, 2), (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: 'ok' });
  });
});

// 保存打卡记录到 attendance.json
app.post('/api/saveAttendance', (req, res) => {
  const file = path.join(__dirname, 'attendance.json');
  fs.writeFile(file, JSON.stringify(req.body, null, 2), (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: 'ok' });
  });
});

app.get('/attendance.json', (req, res) => {
  const file = path.join(__dirname, 'attendance.json');
  fs.readFile(file, 'utf8', (err, data) => {
    if (err) return res.json([]);
    try {
      res.json(JSON.parse(data));
    } catch {
      res.json([]);
    }
  });
});

app.listen(8000, () => console.log('Server running at http://localhost:8000'));

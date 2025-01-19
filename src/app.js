require('dotenv').config();
const express = require('express');
const agentRoutes = require('./routes/agentRoutes');

const app = express();

app.use(express.json());
app.use('/api', agentRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
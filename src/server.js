require('dotenv').config();
const express = require('express');
const cors = require('cors');
const agentRoutes = require('./routes/agentRoutes');

const app = express();

// 👇 Parse the allowed origins
const allowedOrigins = process.env.CORS_ORIGIN.split(',');

const corsOptions = {
  origin: function (origin, callback) {
    // Allow undefined origins (like curl/Postman) or match the whitelist
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());
app.use('/', agentRoutes);

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const opportunitiesRoutes = require('./routes/opportunities.routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

// CORS_ORIGIN aceita uma ou mais origens separadas por vírgula
// (ex.: "https://edubot.app,https://edubot-preview.vercel.app").
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
  })
);
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', sprint: '02' }));

app.use('/api/auth', authRoutes);
app.use('/api/opportunities', opportunitiesRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const opportunitiesRoutes = require('./routes/opportunities.routes');
const schoolsRoutes = require('./routes/schools.routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', sprint: '02' }));

app.use('/api/auth', authRoutes);
app.use('/api/opportunities', opportunitiesRoutes);
app.use('/api/schools', schoolsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

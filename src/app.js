const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const opportunitiesRoutes = require('./routes/opportunities.routes');
const schoolsRoutes = require('./routes/schools.routes');
const webhooksRoutes = require('./routes/webhooks.routes');
const supportRoutes = require('./routes/support.routes');
const metricsRoutes = require('./routes/metrics.routes');
const integrationsRoutes = require('./routes/integrations.routes');
const studentsRoutes = require('./routes/students.routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', sprint: '06' }));

app.use('/api/auth', authRoutes);
app.use('/api/opportunities', opportunitiesRoutes);
app.use('/api/schools', schoolsRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/support-requests', supportRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/students', studentsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

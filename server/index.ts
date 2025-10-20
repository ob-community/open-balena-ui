const express = require('express');
const registryImageRoutes = require('./routes/registryImage');
const { getReactAppEnv } = require('./controller/appEnvironment');

require('dotenv').config();

const PORT = parseInt(process.env.PORT || 3000);
const HOST = '0.0.0.0';

const app = express();

app.use('/', registryImageRoutes);
app.get('/environment.js', getReactAppEnv);
app.get('*', express.static('dist'));

app.listen(PORT, HOST);
console.log(`Running open-balena-ui on http://${HOST}:${PORT}`);

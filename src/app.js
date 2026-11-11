const path = require('path');
const express = require('express');
const config = require('./config');
const indexRoutes = require('./routes/index');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
// Uploaded medicine images are served from the local file system.
app.use('/uploads', express.static(path.resolve(config.uploadDir)));

app.use('/', indexRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'Page not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: err.message });
});

module.exports = app;

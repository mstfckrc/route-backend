const express = require('express');
const router = express.Router();

const rotaRouter = require('./rota');

router.use('/rota', rotaRouter);

module.exports = router;
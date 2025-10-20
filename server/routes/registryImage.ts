const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const { authorize, dosProtect } = require('../middleware');
const { deleteRegistryImage, deleteOrphanedRegistryImages } = require('../controller/registryImage');

router.use(bodyParser.json());

router.post('/deleteRegistryImage', ...dosProtect, authorize, (req, res) => {
  const { imageLocationHash } = req.body;

  if (imageLocationHash) {
    deleteRegistryImage(imageLocationHash)
      .then(() => {
        res.status(200).json({ success: true });
      })
      .catch((err) => {
        res.status(400).json({ success: false, message: err.message });
      });
  } else {
    res.status(406).json({ success: false, message: 'Request is lacking imageLocationHash in body context' });
  }
});

router.post('/deleteOrphanedRegistryImages', ...dosProtect, authorize, (req, res) => {
  const { databaseImages } = req.body;

  if (databaseImages) {
    deleteOrphanedRegistryImages(databaseImages)
      .then((tobeDeleted) => {
        res.status(200).json({ success: true, ...tobeDeleted });
      })
      .catch((err) => {
        res.status(400).json({ success: false, message: err.message });
      });
  } else {
    res.status(406).json({ success: false, message: 'Request is lacking databaseImages in body context' });
  }
});

module.exports = router;

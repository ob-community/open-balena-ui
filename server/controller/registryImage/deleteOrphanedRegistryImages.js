const { s3Client, bucketNames } = require('../../util/s3');

module.exports = (databaseImages) =>
  new Promise((resolve, reject) => {
    const imageRepositories = `data/docker/registry/v2/repositories/v2/`;
    const registryImages = [];
    const objectsStream = s3Client.listObjects(bucketNames.registry, imageRepositories, false);

    objectsStream.on('data', (obj) => {
      registryImages.push(obj.prefix.split('repositories/v2/')[1].split('/')[0]);
    });

    objectsStream.on('error', (err) => {
      reject(err);
    });

    objectsStream.on('end', () => {
      const orphanedImages = registryImages.filter((x) => !databaseImages.includes(x));
      const imagesToDelete = databaseImages.filter((x) => !registryImages.includes(x));
      resolve({ orphanedImages, imagesToDelete });

      /*
    s3Client.removeObjects(bucketNames.registry, objectsList, (err) => {
      if (err) {
        reject (err);
      }
      else {
        resolve();
      }
    });
    */
    });
  });

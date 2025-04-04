const { s3Client, bucketNames } = require('../../util/s3');

module.exports = (imageLocationHash) =>
  new Promise((resolve, reject) => {
    const imageRepository = `data/docker/registry/v2/repositories/v2/${imageLocationHash}`;
    const objectsList = [];
    const objectsStream = s3Client.listObjects(bucketNames.registry, imageRepository, true);

    objectsStream.on('data', (obj) => {
      objectsList.push(obj.name);
    });

    objectsStream.on('error', (err) => {
      reject(err);
    });

    objectsStream.on('end', () => {
      if (objectsList.length === 0) {
        reject(new Error('image not found'));
      }
      s3Client.removeObjects(bucketNames.registry, objectsList, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });

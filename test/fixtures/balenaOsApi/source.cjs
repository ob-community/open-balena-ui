const http = require('node:http');
const crypto = require('node:crypto');

const slugs = ['generic-aarch64', 'generic-amd64', 'iot-gate-imx8', 'iot-gate-imx8plus', 'iot-gate-imx8plus-d1d8'];
const uuid = (id) => `00000000000040008000${String(id).padStart(12, '0')}`;
const metadata = (slug, buildId) => ({
  slug,
  name: slug,
  arch: slug === 'generic-amd64' ? 'amd64' : 'aarch64',
  state: 'released',
  buildId,
  options: [],
  yocto: { deployArtifact: 'balena.img', machine: slug },
});
const assets = Object.fromEntries(
  slugs.map((slug) => {
    const body = JSON.stringify(metadata(slug, '8.0.0'));
    const checksum = crypto.createHash('sha256').update(body).digest('hex');
    return [
      slug,
      {
        body,
        filename: 'device-type.json',
        href: `http://source:8080/assets/${slug}/${checksum}/device-type.json`,
        content_type: 'application/json',
        size: Buffer.byteLength(body),
        checksum,
      },
    ];
  }),
);
const escapeXml = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const createSourceServer = () => {
  let hung = false;
  let upstreamReads = 0;
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://source:8080');
    const json = (body) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/control/hang') {
      hung = true;
      return json({ hung });
    }
    if (url.pathname === '/fixture/assets') return json(assets);
    if (url.pathname === '/fixture/upstream-reads') return json({ upstreamReads });
    if (url.pathname.startsWith('/assets/')) {
      const asset = assets[url.pathname.split('/')[2]];
      if (!asset) {
        res.statusCode = 404;
        return res.end();
      }
      return json(JSON.parse(asset.body));
    }
    if (/^\/v[67]\//.test(url.pathname)) {
      const resource = url.pathname.split('/').pop();
      const filter = url.searchParams.get('$filter') ?? '';
      let records = [];
      if (resource === 'application') {
        if (filter.includes('balenahup')) {
          records = [
            {
              id: 900,
              uuid: uuid(900),
              app_name: 'balenahup',
              slug: 'balena_os/balenahup',
              is_host: false,
              is_public: true,
              is_of__class: 'block',
              is_archived: false,
            },
          ];
        } else {
          records = slugs.flatMap((slug, index) =>
            filter.includes(`'balena_os/${slug}'`)
              ? [
                  {
                    id: index + 100,
                    uuid: uuid(index + 100),
                    app_name: slug,
                    slug: `balena_os/${slug}`,
                    is_host: true,
                    is_public: true,
                    is_of__class: 'app',
                    is_archived: false,
                  },
                ]
              : [],
          );
        }
      }
      if (resource === 'release') {
        const id = Number(/belongs_to__application eq (\d+)/.exec(filter)?.[1]);
        records = [
          {
            id: id + 1000,
            commit: crypto.createHash('sha1').update(`fixture-${id}`).digest('hex'),
            raw_version: id === 900 ? '4.0.0' : '8.0.0',
            semver: id === 900 ? '4.0.0' : '8.0.0',
            revision: 0,
            variant: '',
            status: 'success',
            is_final: true,
            is_invalidated: false,
            is_passing_tests: true,
            composition: {},
            source: 'cloud',
            start_timestamp: '2026-01-01T00:00:00.000Z',
            end_timestamp: '2026-01-01T00:01:00.000Z',
            update_timestamp: '2026-01-01T00:01:00.000Z',
            is_finalized_at__date: '2026-01-01T00:01:00.000Z',
          },
        ];
      }
      return json({ d: records });
    }
    if (url.searchParams.has('list-type')) {
      upstreamReads++;
      if (hung) return;
      const prefix = url.searchParams.get('prefix') ?? '';
      const folders =
        prefix === 'images/'
          ? slugs.map((slug) => `images/${slug}/`)
          : slugs.some((slug) => prefix === `images/${slug}/`)
            ? [`${prefix}7.0.0/`]
            : [];
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.end(
        `<?xml version="1.0"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>fixture</Name><Prefix>${escapeXml(prefix)}</Prefix><IsTruncated>false</IsTruncated>${folders.map((folder) => `<CommonPrefixes><Prefix>${escapeXml(folder)}</Prefix></CommonPrefixes>`).join('')}</ListBucketResult>`,
      );
    }
    const slug = slugs.find((value) => url.pathname.includes(`/${value}/`));
    upstreamReads++;
    if (slug && url.pathname.endsWith('/device-type.json')) return json(metadata(slug, '7.0.0'));
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/xml');
    res.end('<Error><Code>NoSuchKey</Code><Message>Fixture object absent</Message></Error>');
  });
};

module.exports = { createSourceServer };

if (require.main === module) {
  createSourceServer().listen(8080, '0.0.0.0');
}

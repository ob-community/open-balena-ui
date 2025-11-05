# User Interface for Open Balena Admin

User interface for [open-balena-admin](https://github.com/dcaputo-harmoni/open-balena-admin), an admin interface for
open-balena.

## Dependencies

This project is dependent on [open-balena-postgrest](https://github.com/dcaputo-harmoni/open-balena-postgrest) and
[open-balena-remote](https://github.com/dcaputo-harmoni/open-balena-remote), so the easiest way to get this up and
running would be to install it via the [open-balena-admin](https://github.com/dcaputo-harmoni/open-balena-admin)
project.

## Configuration

There are a number of environment variables used to configure the ui:

- `PORT` - The port that the ui will listen on

- `REACT_APP_OPEN_BALENA_POSTGREST_URL` The URL (accessible to API) of the `open-balena-postgrest` instance, i.e.
  `http://postgrest.openbalena.local:8000`

- `REACT_APP_OPEN_BALENA_REMOTE_URL` The URL (accessible to API) of the `open-balena-remote` instance, i.e.
  `http://remote.openbalena.local:10000`

- `REACT_APP_OPEN_BALENA_API_URL` The URL (accessible to API) of the `open-balena-api` instance, i.e.
  `https://api.openbalena.local`

- `REACT_APP_OPEN_BALENA_API_VERSION` The version of `open-balena-api` that the above instance is running, i.e.
  `v0.139.0`

- `REACT_APP_BANNER_IMAGE` The URL of a custom banner image to use on the main dashboard.

These variables can be supplied through the standard Vite `.env` files (for example `.env`, `.env.local`, or
`.env.<mode>` when invoking `vite --mode <mode>`). The active mode is already set for the provided `npm run dev` and
`npm run dev:local` scripts.

## Exposing Device Connection Endpoints

Each device has a "Connect" button which uses balena image labels to discover available services on that device. To make
use of this auto-discovery, you will need to add tags to each container within your balena application's
`docker-compose` file where you would like to expose services. Examples of the three types of services available to
expose are provided below (http, https and vnc); note that ssh services are enabled by default and do not need labels.
When a device is running an application that exposes container services using the label constructs below, you will see
the service appear in the list of available connections for that container when clicking the "Connect" button for that
device in the admin ui.

HTTP Services:

```sh
    labels:
      openbalena.remote.http: '1'
      openbalena.remote.http.port: '5003'
      openbalena.remote.http.path: '/'
```

HTTPS Services:

```sh
    labels:
      openbalena.remote.https: '1'
      openbalena.remote.https.port: '1880'
      openbalena.remote.https.path: '/nr-admin'
```

VNC Services:

```sh
    labels:
      openbalena.remote.vnc: '1'
      openbalena.remote.vnc.port: '5900'
```

**Note**: The port specified above is a host container port, so the service needs to be mapped to a host port matching
the port specified in the label in your `docker-compose` file.

## Dashboard URL Routes

`open-balena-ui` includes routes that conform to the standard balena convention that you will see when running
`balena devices` using `balena-cli`. Specifically, if you point your browser to your `open-balena-ui` server with a path
of `/devices/<UUID>/summary`, it will redirect you to the dashboard for that device. If you point the
`dashboard.yourdomain.com` host to your `open-balena-ui` instance, the URL should conform to the standard balena
convention.

## Compatibility

This project is compatible with `open-balena-api` v0.139.0 or newer, all the way up to the current builds (v0.190.0).
See [this project](https://github.com/dcaputo-harmoni/open-balena-helm) for a fork of bartversluijs' open-balena-helm
project which has helm scripts to build a current version of `open-balena`.

## Installation

Ensure you are running Node.js 24 or newer locally to match the production image and CI configuration.

Set the required environment variables accordingly, and run `npm run start` from the main project folder. If running
locally, you can access `open-balena-ui` via your web browser at `http://localhost:PORT`, and provided the configuration
environment variables are appropriately pointed to live `open-balena-api` and `open-balena-postgrest` instances, you
should be up and running.

## Development

For local development, the Vite dev server exposes two modes:

- `npm run dev` launches with the `devprod` mode configuration (mirroring hosted settings).
- `npm run dev:local` loads the `local` mode configuration for working against local services.

When you need a production-like client build, run `npm run build:client` (or `npm run build` to bundle both client and
server) followed by `npm run serve` to boot the compiled Express server.

## Credits

- The [ra-data-postgrest](https://github.com/raphiniert-com/ra-data-postgrest) project was instrumental in establishing
  the link to the open-balena database

## Legacy Items

- **Expanded Vite config**: The configuration keeps legacy behavior from the original webpack/CRA setup—explicit aliases
  and polyfills for the Node-style modules above, plus tailored build/preview settings so the Express server can serve
  the SPA exactly as before.

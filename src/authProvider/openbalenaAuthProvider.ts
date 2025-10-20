import { jwtDecode } from 'jwt-decode';
import environment from '../lib/reactAppEnv';

const authProvider = {
  login: ({ username, password }) => {
    console.log(`Attempting to fetch ${environment.REACT_APP_OPEN_BALENA_API_URL}/login_`);
    return fetch(`${environment.REACT_APP_OPEN_BALENA_API_URL}/login_`, {
      method: 'POST',
      body: JSON.stringify({ username: username, password: password }),
      headers: new Headers({ 'Content-Type': 'application/json' }),
      insecureHTTPParser: true,
    })
      .then((response) => {
        if (response.status < 200 || response.status >= 300) {
          throw new Error(response.statusText);
        }
        return response.body
          .getReader()
          .read()
          .then((streamData) => {
            let token = new TextDecoder().decode(streamData.value);
            localStorage.setItem('auth', token);
          });
      })
      .catch(() => {
        throw new Error(`Error: Could not log in as user ${username}`);
      });
  },
  checkAuth: (params) => {
    return localStorage.getItem('auth') ? Promise.resolve() : Promise.reject();
  },
  getPermissions: (params) => {
    const jwt = localStorage.getItem('auth');
    return jwt ? Promise.resolve(jwtDecode(jwt).permissions) : Promise.reject();
  },
  checkError: (error) => {
    console.log(error);
    const status = error.status;
    if (status === 504 || status === 403 || status === 504) {
      localStorage.removeItem('auth');
      return Promise.reject();
    }
    return Promise.resolve();
  },
  logout: () => {
    localStorage.removeItem('auth');
    return Promise.resolve();
  },
  getSession: () => {
    const jwt = localStorage.getItem('auth');
    return { jwt: jwt, object: jwtDecode(jwt) };
  },
};

export default authProvider;

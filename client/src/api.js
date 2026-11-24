import axios from 'axios';

const api = axios.create({ baseURL: '/api', headers: { 'X-Requested-With': 'fetch' } });

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401 && !location.pathname.startsWith('/login')) {
      window.dispatchEvent(new Event('auth:expired'));
    }
    return Promise.reject(new Error(err.response?.data?.error || err.message));
  }
);

export default api;

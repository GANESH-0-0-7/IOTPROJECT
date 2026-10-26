const environment = import.meta.env || (typeof process !== 'undefined' ? process.env : {});
export const DATA_MODE = environment.VITE_DATA_MODE === 'local' ? 'local' : 'live';
export const BASE_URL = (environment.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');

import { handleRequest } from '../../server/backend.mjs';
export const onRequest = ({ request, env }) => handleRequest(request, env);

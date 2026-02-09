import { Router } from 'itty-router';

const router = Router();

router.get('/test', () => new Response('ok'));

console.log('Router created');

const req = new Request('http://localhost/test');
router.handle(req).then(res => res.text()).then(console.log).catch(console.error);

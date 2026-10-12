import { Stage } from './stage.js';

const stage = new Stage((msg) => self.postMessage(msg));
self.onmessage = (e) => stage.handle(e.data);

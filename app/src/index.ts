import { createApp } from './app.js';
import { getStore } from './store.js';

const PORT = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(PORT, async () => {
  const store = await getStore();
  console.log(`R1 Tires app on http://localhost:${PORT}  [store: ${store.kind()}]`);
});

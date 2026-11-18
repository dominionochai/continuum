import { fileURLToPath } from 'node:url';

const page = (name: string) => fileURLToPath(new URL(`./${name}.html`, import.meta.url));
export default { build: { rollupOptions: { input: { index: page('index'), compare: page('compare') } } } };
